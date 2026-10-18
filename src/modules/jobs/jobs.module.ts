import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { JobAiSearchService } from './ai/job-ai-search.service';
import { IngestKeyGuard } from './guards/ingest-key.guard';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AiModule],
  controllers: [JobsController],
  providers: [JobsService, IngestKeyGuard, JobAiSearchService],
  exports: [JobsService],
})
export class JobsModule {}
