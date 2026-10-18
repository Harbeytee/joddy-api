import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type { JobSyncRun } from '../../generated/prisma/client';
import { JobSyncStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { JobFeedImporter } from './job-feed.importer';
import { ScraperRunner } from './scraper.runner';

/** How often to check whether a sync is due; each check is a few cheap queries. */
const CHECK_EVERY_MS = 5 * 60_000;
/** After a failed sync, wait this long before trying again instead of the full interval. */
const RETRY_AFTER_MS = 30 * 60_000;
const LOCK_KEY = 'joddy:job-sync';

/**
 * Keeps the job list fresh: every JOB_SYNC_EVERY_HOURS it runs the job-scraper and imports the
 * feed, closing jobs that are no longer listed. Each run is recorded in job_sync_runs, which also
 * acts as the lock, so several workers can run and only one of them syncs at a time.
 */
@Injectable()
export class JobSyncWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(JobSyncWorker.name);
  private readonly abort = new AbortController();
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: ScraperRunner,
    private readonly importer: JobFeedImporter,
    private readonly config: AppConfigService,
  ) {}

  start() {
    if (!this.config.get('JOB_SYNC_SCRAPER_DIR')) {
      this.logger.log(
        'Job sync is off: set JOB_SYNC_SCRAPER_DIR to scrape and import jobs on a schedule',
      );
      return;
    }
    this.logger.log(
      `Job sync started: scraping and importing jobs every ${this.config.get('JOB_SYNC_EVERY_HOURS')} hours`,
    );
    this.schedule(0);
  }

  async onApplicationShutdown() {
    clearTimeout(this.timer);
    this.abort.abort();
    await this.running;
  }

  /** Runs a sync if one is due and no other worker is running one. Returns the finished run, if any. */
  async runIfDue(): Promise<JobSyncRun | null> {
    const run = await this.claim();
    if (!run) return null;
    this.logger.log('Job sync: scraping job boards');
    try {
      const feed = await this.scraper.run(this.abort.signal);
      this.logger.log('Job sync: importing jobs');
      const result = await this.importer.importFile(feed);
      this.logger.log(
        `Job sync finished: ${result.imported} jobs imported, ${result.deactivated} closed, ${result.skipped} skipped as invalid`,
      );
      return await this.prisma.jobSyncRun.update({
        where: { id: run.id },
        data: { status: JobSyncStatus.SUCCEEDED, finishedAt: new Date(), ...result },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job sync failed: ${message}`);
      return await this.prisma.jobSyncRun.update({
        where: { id: run.id },
        data: {
          status: JobSyncStatus.FAILED,
          finishedAt: new Date(),
          error: message.slice(0, 2000),
        },
      });
    }
  }

  private schedule(ms: number) {
    if (this.abort.signal.aborted) return;
    this.timer = setTimeout(() => {
      this.running = this.runIfDue()
        .catch((err: unknown) => this.logger.error(`Job sync check failed: ${String(err)}`))
        .finally(() => this.schedule(CHECK_EVERY_MS));
    }, ms);
  }

  /** Records a new RUNNING run if a sync is due. The advisory lock makes the check-and-insert atomic. */
  private claim(): Promise<JobSyncRun | null> {
    return this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS locked`;
      if (!locked) return null;

      const now = Date.now();
      const timeoutMs = this.config.get('JOB_SYNC_TIMEOUT_MINUTES') * 60_000;
      // Still RUNNING well past its timeout: the worker that owned it died mid-run.
      await tx.jobSyncRun.updateMany({
        where: {
          status: JobSyncStatus.RUNNING,
          startedAt: { lt: new Date(now - timeoutMs - CHECK_EVERY_MS) },
        },
        data: {
          status: JobSyncStatus.FAILED,
          finishedAt: new Date(now),
          error: 'Interrupted: the worker stopped during this run',
        },
      });
      if (await tx.jobSyncRun.count({ where: { status: JobSyncStatus.RUNNING } })) return null;

      const everyMs = this.config.get('JOB_SYNC_EVERY_HOURS') * 3_600_000;
      const lastOk = await tx.jobSyncRun.findFirst({
        where: { status: JobSyncStatus.SUCCEEDED },
        orderBy: { startedAt: 'desc' },
      });
      if (lastOk && now - lastOk.startedAt.getTime() < everyMs) return null;
      const lastFailed = await tx.jobSyncRun.findFirst({
        where: { status: JobSyncStatus.FAILED },
        orderBy: { startedAt: 'desc' },
      });
      if (lastFailed && now - lastFailed.startedAt.getTime() < RETRY_AFTER_MS) return null;

      return tx.jobSyncRun.create({ data: { startedAt: new Date(now) } });
    });
  }
}
