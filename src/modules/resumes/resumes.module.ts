import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ResumeAiService } from './ai/resume-ai.service';
import { ResumesController } from './resumes.controller';
import { ResumesService } from './resumes.service';

@Module({
  imports: [AiModule],
  controllers: [ResumesController],
  providers: [ResumesService, ResumeAiService],
})
export class ResumesModule {}
