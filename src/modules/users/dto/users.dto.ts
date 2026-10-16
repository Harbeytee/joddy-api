import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Frontend engineer, 3 years in fintech' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional({ example: 'London, UK' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiPropertyOptional({ type: [String], example: ['TypeScript', 'Vue', 'PostgreSQL'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? [...new Set(value.map((s) => String(s).trim()).filter(Boolean))] : value,
  )
  skills?: string[];
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class DeleteAccountDto {
  @ApiProperty({ description: 'Current password, to confirm the deletion' })
  @IsString()
  @MaxLength(128)
  password: string;
}
