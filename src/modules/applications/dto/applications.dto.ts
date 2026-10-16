import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ApplicationStatus, JobType } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateApplicationDto {
  @ApiPropertyOptional({ description: 'Link to a job from the jobs feed; fills role and company' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ example: 'Frontend Engineer' })
  @ValidateIf((o: CreateApplicationDto) => !o.jobId)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  role?: string;

  @ApiPropertyOptional({ example: 'Monzo' })
  @ValidateIf((o: CreateApplicationDto) => !o.jobId)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ enum: JobType })
  @IsOptional()
  @IsEnum(JobType)
  jobType?: JobType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  location?: string;
  @ApiPropertyOptional({ example: 'LinkedIn' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional() @IsOptional() @IsUrl() @MaxLength(2000) url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() resumeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() appliedAt?: string;
}

export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

export class ApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ description: 'Search role or company' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
