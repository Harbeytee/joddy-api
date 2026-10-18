import { BadRequestException, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentService } from './agent.service';

/** How often to check whether anyone is due a search; each check is one cheap query. */
const CHECK_EVERY_MS = 60_000;
/** Users claimed per query, so one pass never holds many rows. */
const BATCH_SIZE = 20;

/**
 * Looks for new matches on a schedule, for every user who has auto-apply on, exactly as if they
 * had clicked "Find jobs now": AUTO users' matches go to Joddy's queue, REVIEW users' wait for
 * them to choose. The daily limit still applies. Several workers can run at once: each user is
 * claimed by bumping `lastRunAt` with FOR UPDATE SKIP LOCKED, so nobody is searched twice.
 */
@Injectable()
export class MatchWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(MatchWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly config: AppConfigService,
  ) {}

  start() {
    this.logger.log(
      `Match worker started: looking for new jobs every ${this.config.get('AUTO_APPLY_MATCH_EVERY_MINUTES')} minutes for users with auto-apply on`,
    );
    this.schedule(0);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** Searches for every user who is due. Returns how many users were searched. */
  async runDue(): Promise<number> {
    let searched = 0;
    while (!this.stopping) {
      const userIds = await this.claimDue();
      for (const userId of userIds) {
        if (this.stopping) break;
        await this.runFor(userId);
        searched++;
      }
      if (userIds.length < BATCH_SIZE) break;
    }
    return searched;
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.runDue()
        .then(() => undefined)
        .catch((err: unknown) => this.logger.error(`Match loop failed: ${String(err)}`))
        .finally(() => this.schedule(CHECK_EVERY_MS));
    }, ms);
  }

  /** Users with auto-apply on and job titles set who haven't been searched within the interval. */
  private async claimDue(): Promise<string[]> {
    const minutes = this.config.get('AUTO_APPLY_MATCH_EVERY_MINUTES');
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      UPDATE agent_settings
      SET "lastRunAt" = now() AT TIME ZONE 'UTC'
      WHERE "userId" IN (
        SELECT "userId"
        FROM agent_settings
        WHERE enabled
          AND cardinality(keywords) > 0
          AND ("lastRunAt" IS NULL
               OR "lastRunAt" < now() AT TIME ZONE 'UTC' - make_interval(mins => ${minutes}))
        ORDER BY "lastRunAt" NULLS FIRST
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "userId"`;
    return rows.map((r) => r.userId);
  }

  private async runFor(userId: string) {
    try {
      const result = await this.agent.run(userId);
      if (result.queued) this.logger.log(`Found ${result.queued} new match(es) for user ${userId}`);
    } catch (err) {
      // Missing skills or similar: the page already tells the user; try again next interval.
      if (err instanceof BadRequestException) {
        this.logger.debug(`Skipped user ${userId}: ${err.message}`);
      } else {
        this.logger.error(`Search failed for user ${userId}: ${String(err)}`);
      }
    }
  }
}
