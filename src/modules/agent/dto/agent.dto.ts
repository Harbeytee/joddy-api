import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AgentMode, AgentTaskStatus } from '../../../generated/prisma/enums';

const cleanList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((s) => String(s).trim()).filter(Boolean))] : value;

export class UpdateAgentSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ enum: AgentMode })
  @IsOptional()
  @IsEnum(AgentMode)
  mode?: AgentMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  dailyLimit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minMatchScore?: number;

  @ApiPropertyOptional({ type: [String], example: ['frontend engineer', 'vue developer'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(cleanList)
  keywords?: string[];

  @ApiPropertyOptional({ type: [String], example: ['senior', 'staff'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(cleanList)
  excludedKeywords?: string[];

  @ApiPropertyOptional({ type: [String], example: ['London', 'Remote'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(cleanList)
  locations?: string[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() remoteOnly?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  resumeId?: string | null;
}

export class AgentTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AgentTaskStatus })
  @IsOptional()
  @IsEnum(AgentTaskStatus)
  status?: AgentTaskStatus;
}
