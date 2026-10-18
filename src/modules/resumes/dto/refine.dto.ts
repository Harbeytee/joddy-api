import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { REFINE_FIELDS, REFINE_MIN_LENGTH, type RefineField } from '../ai/refine-prompt';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** What the text is about, so the wording fits. Never added to the text itself. */
class RefineContextDto {
  @IsOptional() @IsString() @MaxLength(160) headline?: string;
  @IsOptional() @IsString() @MaxLength(150) position?: string;
  @IsOptional() @IsString() @MaxLength(150) company?: string;
  @IsOptional() @IsBoolean() current?: boolean;
  @IsOptional() @IsString() @MaxLength(150) degree?: string;
  @IsOptional() @IsString() @MaxLength(150) school?: string;
  @IsOptional() @IsString() @MaxLength(150) project?: string;
  @IsOptional() @IsString() @MaxLength(60) section?: string;
}

export class RefineTextDto {
  @ApiProperty({ enum: REFINE_FIELDS })
  @IsIn(REFINE_FIELDS)
  field: RefineField;

  @ApiProperty({ example: 'built the new checkout\nmade the app faster' })
  @Transform(trim)
  @IsString()
  @MinLength(REFINE_MIN_LENGTH)
  @MaxLength(5000)
  text: string;

  @ApiPropertyOptional({
    description: 'Longest suggestion the field can hold, if shorter than the default',
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(5000)
  maxLength?: number;

  @ApiPropertyOptional({ type: RefineContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RefineContextDto)
  context?: RefineContextDto;
}
