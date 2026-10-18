import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentService } from './agent.service';
import { ApplicantService, CV_MAX_BYTES, type UploadedCv } from './applicant.service';
import { AgentTasksQueryDto, UpdateAgentSettingsDto } from './dto/agent.dto';
import { AnswerTaskDto, UpdateApplicantProfileDto } from './dto/applicant.dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly applicant: ApplicantService,
  ) {}

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.agent.getSettings(user.id);
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateAgentSettingsDto) {
    return this.agent.updateSettings(user.id, dto);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.applicant.get(user.id);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateApplicantProfileDto) {
    return this.applicant.update(user.id, dto);
  }

  @Put('profile/cv')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CV_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  uploadCv(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedCv | undefined) {
    return this.applicant.uploadCv(user.id, file);
  }

  @Get('profile/cv')
  async downloadCv(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const cv = await this.applicant.getCv(user.id);
    res.set({
      'Content-Type': cv.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(cv.fileName)}`,
    });
    return new StreamableFile(Buffer.from(cv.data));
  }

  @Delete('profile/cv')
  deleteCv(@CurrentUser() user: AuthUser) {
    return this.applicant.deleteCv(user.id);
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

  @Post('tasks/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agent.retry(user.id, id);
  }

  @Post('tasks/:id/answers')
  @HttpCode(HttpStatus.OK)
  answer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerTaskDto,
  ) {
    return this.agent.answer(user.id, id, dto.answers);
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
