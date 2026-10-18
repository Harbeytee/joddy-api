import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ApplicantService } from './applicant.service';

@Module({
  controllers: [AgentController],
  providers: [AgentService, ApplicantService],
  exports: [AgentService, ApplicantService],
})
export class AgentModule {}
