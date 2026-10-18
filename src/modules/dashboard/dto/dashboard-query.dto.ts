import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, ValidateBy } from 'class-validator';
import { isTimeZone } from '../../../common/utils/time-zone';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    example: 'Europe/London',
    description: 'IANA time zone of the viewer; weeks in the activity chart start on their Monday',
  })
  @IsOptional()
  @ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: isTimeZone,
      defaultMessage: () => 'tz must be an IANA time zone, e.g. Europe/London',
    },
  })
  tz?: string;
}
