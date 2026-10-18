import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Must match the template registry in joddy-fe (app/utils/resume-templates.ts). */
export const RESUME_TEMPLATES = [
  'classic',
  'modern',
  'minimal',
  'harvard',
  'executive',
  'corporate',
  'timeline',
  'sidebar',
  'slate',
  'nordic',
  'metro',
  'compact',
  'elegant',
  'bold',
  'tech',
  'creative',
  'ledger',
  'horizon',
  'mono',
  'atlas',
  'contrast',
  'pastel',
  'boxed',
  'ivy',
] as const;

export const RESUME_FONTS = [
  'inter',
  'lato',
  'roboto',
  'source-sans',
  'montserrat',
  'raleway',
  'ibm-plex',
  'merriweather',
  'lora',
  'garamond',
  'playfair',
] as const;

export const RESUME_SECTIONS = [
  'summary',
  'experience',
  'education',
  'projects',
  'skills',
  'certifications',
  'languages',
  'interests',
] as const;

export const MAX_CUSTOM_SECTIONS = 10;
const CUSTOM_ID = '[a-z0-9-]{1,40}';
/** A built-in section, or `custom:<id>` for one of the user's own sections. */
const SECTION_KEY = new RegExp(`^(${RESUME_SECTIONS.join('|')}|custom:${CUSTOM_ID})$`);

export const LANGUAGE_LEVELS = ['native', 'fluent', 'advanced', 'intermediate', 'basic'] as const;

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

class ProjectDto {
  @IsString() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(150) role?: string;
  @IsOptional() @IsString() @MaxLength(300) url?: string;
  /** Shown instead of the address, which stays the link target. */
  @IsOptional() @IsString() @MaxLength(60) urlLabel?: string;
  @IsOptional() @IsString() @MaxLength(20) startDate?: string;
  @IsOptional() @IsString() @MaxLength(20) endDate?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
}

class CustomEntryDto {
  @IsOptional() @IsString() @MaxLength(150) title?: string;
  @IsOptional() @IsString() @MaxLength(150) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(40) date?: string;
  @IsOptional() @IsString() @MaxLength(300) url?: string;
  @IsOptional() @IsString() @MaxLength(60) urlLabel?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
}

/** A section the user names themselves, e.g. Volunteering, Awards or Publications. */
class CustomSectionDto {
  @Matches(new RegExp(`^${CUSTOM_ID}$`), { message: 'custom section id is invalid' })
  id: string;

  @IsOptional() @IsString() @MaxLength(60) title?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CustomEntryDto)
  entries: CustomEntryDto[];
}

class CertificationDto {
  @IsString() @MaxLength(150) name: string;
  @IsOptional() @IsString() @MaxLength(150) issuer?: string;
  @IsOptional() @IsString() @MaxLength(20) date?: string;
  @IsOptional() @IsString() @MaxLength(300) url?: string;
}

class LanguageDto {
  @IsString() @MaxLength(50) name: string;
  @IsOptional() @IsIn(LANGUAGE_LEVELS) level?: (typeof LANGUAGE_LEVELS)[number];
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

  @ApiPropertyOptional({ type: [ProjectDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProjectDto)
  projects?: ProjectDto[];

  @ApiPropertyOptional({ type: [CertificationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  certifications?: CertificationDto[];

  @ApiPropertyOptional({ type: [LanguageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LanguageDto)
  languages?: LanguageDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  interests?: string[];

  @ApiPropertyOptional({ type: [CustomSectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CUSTOM_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => CustomSectionDto)
  custom?: CustomSectionDto[];
}

/** Look-and-feel overrides. Anything left out falls back to the template's own default. */
export class ResumeDesignDto {
  @ApiPropertyOptional({ example: '#5101ff' })
  @IsOptional()
  @Matches(/^#[0-9a-f]{6}$/i, { message: 'accent must be a hex colour like #5101ff' })
  accent?: string;

  @ApiPropertyOptional({ enum: RESUME_FONTS })
  @IsOptional()
  @IsIn(RESUME_FONTS)
  font?: (typeof RESUME_FONTS)[number];

  @ApiPropertyOptional({ enum: ['sm', 'md', 'lg'] })
  @IsOptional()
  @IsIn(['sm', 'md', 'lg'])
  fontSize?: 'sm' | 'md' | 'lg';

  @ApiPropertyOptional({ enum: ['compact', 'normal', 'relaxed'] })
  @IsOptional()
  @IsIn(['compact', 'normal', 'relaxed'])
  spacing?: 'compact' | 'normal' | 'relaxed';

  @ApiPropertyOptional({
    type: [String],
    example: ['summary', 'experience', 'custom:volunteering'],
    description: 'Built-in sections, plus `custom:<id>` for custom sections',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(RESUME_SECTIONS.length + MAX_CUSTOM_SECTIONS)
  @Matches(SECTION_KEY, { each: true, message: 'sectionOrder contains an unknown section' })
  sectionOrder?: string[];
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

  @ApiPropertyOptional({ type: ResumeDesignDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResumeDesignDto)
  design?: ResumeDesignDto;

  @ApiPropertyOptional({ type: ResumeContentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ResumeContentDto)
  content?: ResumeContentDto;
}

export class UpdateResumeDto extends PartialType(CreateResumeDto) {}
