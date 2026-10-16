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
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { DeactivateStaleDto, IngestBatchDto } from './dto/ingest.dto';
import { JobsQueryDto } from './dto/jobs-query.dto';
import { IngestKeyGuard } from './guards/ingest-key.guard';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: JobsQueryDto) {
    return this.jobs.list(user.id, q);
  }

  @Get('saved')
  saved(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    return this.jobs.listSaved(user.id, q);
  }

  @Get('remote-areas')
  remoteAreas() {
    return this.jobs.remoteAreas();
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(user.id, id);
  }

  @Put(':id/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.save(user.id, id);
  }

  @Delete(':id/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.unsave(user.id, id);
  }

  @Put(':id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  hide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.hide(user.id, id);
  }

  @Delete(':id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  unhide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.unhide(user.id, id);
  }

  @Public()
  @SkipThrottle()
  @UseGuards(IngestKeyGuard)
  @ApiHeader({ name: 'x-ingest-key', required: true })
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  ingest(@Body() dto: IngestBatchDto) {
    return this.jobs.ingest(dto.jobs);
  }

  @Public()
  @SkipThrottle()
  @UseGuards(IngestKeyGuard)
  @ApiHeader({ name: 'x-ingest-key', required: true })
  @Post('ingest/deactivate-stale')
  @HttpCode(HttpStatus.OK)
  deactivateStale(@Body() dto: DeactivateStaleDto) {
    return this.jobs.deactivateStale(dto);
  }
}
