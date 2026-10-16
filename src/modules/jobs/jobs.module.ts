import { Module } from '@nestjs/common';
import { IngestKeyGuard } from './guards/ingest-key.guard';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  providers: [JobsService, IngestKeyGuard],
  exports: [JobsService],
})
export class JobsModule {}
