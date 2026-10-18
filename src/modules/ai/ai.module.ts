import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiQuotaService } from './ai-quota.service';
import { GeminiClient } from './gemini.client';

@Module({
  controllers: [AiController],
  providers: [GeminiClient, AiQuotaService],
  exports: [GeminiClient],
})
export class AiModule {}
