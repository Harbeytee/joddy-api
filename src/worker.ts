import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ApplyWorker } from './modules/agent/apply.worker';
import { MatchWorker } from './modules/agent/match.worker';
import { JobSyncWorker } from './modules/job-sync/job-sync.worker';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(JobSyncWorker).start();
  app.get(MatchWorker).start();
  app.get(ApplyWorker).start();
}

void bootstrap();
