import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestJobDto } from '../jobs/dto/ingest.dto';
import { readFeedBatches } from '../jobs/feed/job-feed';
import { JobsService } from '../jobs/jobs.service';

const BATCH_SIZE = 500;
/** A feed with fewer jobs than this share of the active ones looks truncated, so nothing is deactivated. */
const MIN_FEED_SHARE = 0.5;
const MAX_LOGGED_INVALID = 20;

export interface FeedImportResult {
  imported: number;
  skipped: number;
  deactivated: number;
}

/** Imports a job-scraper feed straight into the database, with the same rules as the ingest API. */
@Injectable()
export class JobFeedImporter {
  private readonly logger = new Logger(JobFeedImporter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  async importFile(file: string): Promise<FeedImportResult> {
    // Database time, because ingest stamps lastSeenAt with the database clock.
    const [{ now: startedAt }] = await this.prisma.$queryRaw<{ now: Date }[]>`
      SELECT now() AT TIME ZONE 'UTC' AS now`;
    const activeBefore = await this.prisma.job.count({ where: { isActive: true } });

    let imported = 0;
    let skipped = 0;
    for await (const batch of readFeedBatches(file, BATCH_SIZE)) {
      const valid: IngestJobDto[] = [];
      for (const raw of batch) {
        const job = plainToInstance(IngestJobDto, raw);
        const errors = validateSync(job, { whitelist: true });
        if (!errors.length) {
          valid.push(job);
          continue;
        }
        skipped++;
        if (skipped <= MAX_LOGGED_INVALID) {
          const fields = errors.map((e) => e.property).join(', ');
          this.logger.warn(`Skipped invalid job ${String(raw.id)} (${fields})`);
        }
      }
      if (valid.length) imported += (await this.jobs.ingest(valid)).upserted;
    }

    let deactivated = 0;
    if (imported >= activeBefore * MIN_FEED_SHARE) {
      ({ deactivated } = await this.jobs.deactivateStale({
        notSeenSince: startedAt.toISOString(),
      }));
    } else {
      this.logger.warn(
        `Feed had ${imported} jobs but ${activeBefore} are active; it looks incomplete, so no jobs were marked closed`,
      );
    }
    return { imported, skipped, deactivated };
  }
}
