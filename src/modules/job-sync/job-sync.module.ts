import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { JobFeedImporter } from './job-feed.importer';
import { JobSyncWorker } from './job-sync.worker';
import { ScraperRunner } from './scraper.runner';

@Module({
  imports: [JobsModule],
  providers: [ScraperRunner, JobFeedImporter, JobSyncWorker],
  exports: [JobSyncWorker],
})
export class JobSyncModule {}
