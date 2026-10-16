import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const RESUME_TEMPLATES = ['classic', 'modern', 'minimal'] as const;

class PersonalDto {
  @IsOptional() @IsString() @MaxLength(100) fullName?: string;
  @IsOptional() @IsString() @MaxLength(160) headline?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsString() @MaxLength(300) website?: string;
  @IsOptional() @IsString() @MaxLength(300) linkedin?: string;
}

class ExperienceDto {
  @IsString() @MaxLength(150) position: string;
  @IsString() @MaxLength(150) company: string;
  @IsOptional() @IsString() @MaxLength(100) location?: string;
  @IsOptional() @IsString() @MaxLength(20) startDate?: string;
  @IsOptional() @IsString() @MaxLength(20) endDate?: string;
  @IsOptional() @IsBoolean() current?: boolean;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
}

class EducationDto {
  @IsString() @MaxLength(150) degree: string;
  @IsString() @MaxLength(150) school: string;
  @IsOptional() @IsString() @MaxLength(20) startDate?: string;
  @IsOptional() @IsString() @MaxLength(20) endDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class ResumeContentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalDto)
  personal?: PersonalDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) summary?: string;

  @ApiPropertyOptional({ type: [ExperienceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExperienceDto)
  experience?: ExperienceDto[];

  @ApiPropertyOptional({ type: [EducationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education?: EducationDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  skills?: string[];
}

export class CreateResumeDto {
  @ApiProperty({ example: 'Frontend - 2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ enum: RESUME_TEMPLATES })
  @IsOptional()
  @IsIn(RESUME_TEMPLATES)
  template?: (typeof RESUME_TEMPLATES)[number];

  @ApiPropertyOptional({ type: ResumeContentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResumeContentDto)
  content?: ResumeContentDto;
}

export class UpdateResumeDto extends PartialType(CreateResumeDto) {}
