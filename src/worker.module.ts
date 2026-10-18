import { Module } from '@nestjs/common';
import { AppLoggerModule } from './common/logger.module';
import { AppConfigModule } from './config/config.module';
import { AgentModule } from './modules/agent/agent.module';
import { ApplyWorker } from './modules/agent/apply.worker';
import { MatchWorker } from './modules/agent/match.worker';
import { PlaywrightRobot, ROBOT } from './modules/agent/robot/robot';
import { JobSyncModule } from './modules/job-sync/job-sync.module';
import { PrismaModule } from './prisma/prisma.module';

/** The background worker process: no HTTP server, just the job sync, scheduled searches, the queue and the robot. */
@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule, AgentModule, JobSyncModule],
  providers: [{ provide: ROBOT, useClass: PlaywrightRobot }, ApplyWorker, MatchWorker],
})
export class WorkerModule {}
