import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ApplicationsModule } from '../applications/applications.module';
import { JobsModule } from '../jobs/jobs.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ApplicationsModule, AgentModule, JobsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
