import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { GeminiClient } from './gemini.client';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly gemini: GeminiClient) {}

  /** Whether AI features (job search, resume suggestions) are switched on, so the app can hide them when not. */
  @Public()
  @Get('status')
  status() {
    return { enabled: this.gemini.enabled };
  }
}
