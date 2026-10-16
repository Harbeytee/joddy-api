import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { JobType, Region, Seniority, WorkplaceType } from '../../../generated/prisma/enums';
import { COUNTRY_CODES } from '../geo/countries';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/** Accepts `?seniority=A&seniority=B` as well as `?seniority=A,B`. */
const toList = ({ value }: { value: unknown }): unknown[] =>
  (Array.isArray(value) ? (value as unknown[]) : [value])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .filter((v) => v !== '');

export const JOB_SORTS = ['newest', 'oldest'] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export class JobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Keywords matched against title and company' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ example: 'London' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ enum: WorkplaceType })
  @IsOptional()
  @IsEnum(WorkplaceType)
  workplaceType?: WorkplaceType;

  @ApiPropertyOptional({
    enum: Seniority,
    isArray: true,
    description: 'Any of these levels. MID also matches titles that state no level.',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(Object.keys(Seniority).length)
  @IsEnum(Seniority, { each: true })
  seniority?: Seniority[];

  @ApiPropertyOptional({ enum: JobType, isArray: true, description: 'Any of these job types' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(Object.keys(JobType).length)
  @IsEnum(JobType, { each: true })
  jobType?: JobType[];

  @ApiPropertyOptional({ enum: Region, description: 'Remote jobs advertised for this region' })
  @IsOptional()
  @IsEnum(Region)
  remoteRegion?: Region;

  @ApiPropertyOptional({
    example: 'GB',
    description: 'Remote jobs open in this country (ISO 3166-1 alpha-2)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn([...COUNTRY_CODES])
  remoteCountry?: string;

  @ApiPropertyOptional({ description: 'Only jobs posted within this many days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  postedWithinDays?: number;

  @ApiPropertyOptional({ description: 'Minimum yearly salary (jobs without salary are excluded)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ description: 'Only jobs that list a salary' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hasSalary?: boolean;

  @ApiPropertyOptional({ example: 'greenhouse' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  source?: string;

  @ApiPropertyOptional({ enum: JOB_SORTS, default: 'newest', description: 'By posting date' })
  @IsOptional()
  @IsIn(JOB_SORTS)
  sort?: JobSort;
}
