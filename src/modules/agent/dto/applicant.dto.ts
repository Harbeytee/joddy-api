import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

const MAX_ANSWERS = 300;

/** A plain object of question text → answer, with sensible size limits. */
function IsAnswerMap(): PropertyDecorator {
  return ValidateBy({
    name: 'isAnswerMap',
    validator: {
      validate: (value: unknown) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length <= MAX_ANSWERS &&
        Object.entries(value).every(
          ([question, answer]) =>
            question.length > 0 &&
            question.length <= 1000 &&
            typeof answer === 'string' &&
            answer.length <= 5000,
        ),
      defaultMessage: () => 'Answers must be text of up to 5,000 characters each',
    },
  });
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const cleanList = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((s) => String(s).trim()).filter(Boolean))] : value;

export class UpdateApplicantProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  lastName?: string;

  @ApiPropertyOptional({ example: '+44 7700 900123' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @ValidateIf((_, v) => v !== '')
  @Matches(/^\+?[\d\s().-]{6,}$/, {
    message: 'Enter a phone number with digits only, e.g. +44 7700 900123',
  })
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) @Transform(trim) city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  country?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl(
    { require_protocol: true },
    { message: 'Enter the full LinkedIn link, starting with https://' },
  )
  @MaxLength(300)
  @Transform(trimOrNull)
  linkedinUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl(
    { require_protocol: true },
    { message: 'Enter the full website link, starting with https://' },
  )
  @MaxLength(300)
  @Transform(trimOrNull)
  websiteUrl?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['United Kingdom'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Transform(cleanList)
  workCountries?: string[];

  @ApiPropertyOptional({ nullable: true, example: '1 month' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Transform(trimOrNull)
  noticePeriod?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '£60,000' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  @Transform(trimOrNull)
  salaryExpectation?: string | null;

  @ApiPropertyOptional({
    description: 'Answers to form questions, keyed by question text. Replaces all saved answers.',
    example: { 'How did you hear about us?': 'LinkedIn' },
  })
  @IsOptional()
  @IsAnswerMap()
  answers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Allow Joddy to submit applications on the user’s behalf' })
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class AnswerTaskDto {
  @ApiProperty({
    description: 'Answers to the questions Joddy couldn’t answer, keyed by question text',
    example: { 'Are you amenable with a hybrid work arrangement?': 'Yes' },
  })
  @IsAnswerMap()
  answers!: Record<string, string>;
}
