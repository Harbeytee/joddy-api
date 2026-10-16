import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class IngestSalaryDto {
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) min?: number | null;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) max?: number | null;
  @IsOptional() @IsString() @MaxLength(10) currency?: string | null;
  @IsOptional() @IsString() @MaxLength(20) interval?: string | null;
  /** "structured" when the ATS lists it, "text" when parsed from the description */
  @IsOptional() @IsIn(['structured', 'text']) source?: string;
}

/** Mirrors the normalized job shape produced by the job-scraper project. */
export class IngestJobDto {
  @ApiProperty({ example: 'ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245' })
  @IsString()
  @MaxLength(300)
  id: string;

  @ApiProperty({ example: 'ashby' }) @IsString() @MaxLength(30) source: string;
  @ApiProperty({ example: 'ramp' }) @IsString() @MaxLength(120) company: string;
  @ApiProperty({ example: 'Ramp' }) @IsString() @MaxLength(200) companyName: string;
  @ApiProperty() @IsString() @MaxLength(300) title: string;

  @IsOptional() @IsString() @MaxLength(300) department?: string | null;
  @IsOptional() @IsString() @MaxLength(500) location?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  locations?: string[];

  @IsOptional() @IsIn(['remote', 'hybrid', 'onsite', null]) workplaceType?: string | null;
  @IsOptional() @IsString() @MaxLength(100) employmentType?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => IngestSalaryDto)
  salary?: IngestSalaryDto | null;

  @IsOptional() @IsDateString() postedAt?: string | null;
  @IsUrl({ require_tld: false }) @MaxLength(2000) url: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2000) applyUrl?: string;
  @IsOptional() @IsString() @MaxLength(100_000) description?: string;
}

export class IngestBatchDto {
  @ApiProperty({ type: [IngestJobDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestJobDto)
  jobs: IngestJobDto[];
}

export class DeactivateStaleDto {
  @ApiProperty({
    description: 'Jobs not seen since this time are marked inactive (use the scrape start time)',
  })
  @IsDateString()
  notSeenSince: string;

  @ApiPropertyOptional({ description: 'Limit to one ATS, for partial scrapes' })
  @IsOptional()
  @IsString()
  source?: string;
}
