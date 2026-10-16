import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { WorkplaceType } from '../../../generated/prisma/enums';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

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
}
