import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentService } from './agent.service';
import { AgentTasksQueryDto, UpdateAgentSettingsDto } from './dto/agent.dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.agent.getSettings(user.id);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateAgentSettingsDto) {
    return this.agent.updateSettings(user.id, dto);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.agent.summary(user.id);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  run(@CurrentUser() user: AuthUser) {
    return this.agent.run(user.id);
  }

  @Get('tasks')
  tasks(@CurrentUser() user: AuthUser, @Query() q: AgentTasksQueryDto) {
    return this.agent.listTasks(user.id, q);
  }

  @Post('tasks/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.approve(user.id, id);
  }

  @Post('tasks/:id/skip')
  @HttpCode(HttpStatus.OK)
  skip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.skip(user.id, id);
  }

  @Post('tasks/:id/mark-applied')
  @HttpCode(HttpStatus.OK)
  markApplied(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.markApplied(user.id, id);
  }
}
