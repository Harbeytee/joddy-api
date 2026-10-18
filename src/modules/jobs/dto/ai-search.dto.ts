import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { COUNTRY_CODES } from '../geo/countries';

export class AiSearchDto {
  @ApiProperty({ example: 'Remote senior React jobs in Europe paying over £80k' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  prompt: string;

  @ApiPropertyOptional({
    example: 'NG',
    description: 'The searcher’s country (ISO 3166-1 alpha-2), for prompts like "jobs near me"',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn([...COUNTRY_CODES])
  homeCountry?: string;
}
