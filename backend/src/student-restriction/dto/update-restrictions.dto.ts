import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Flags to change; the others stay as they are. */
export class UpdateStudentRestrictionsDto {
  @ApiPropertyOptional({ description: "Never send the student's work to an AI provider" })
  @IsOptional()
  @IsBoolean()
  noAi?: boolean;

  @ApiPropertyOptional({ description: "Leave the student's submissions out of the similarity check" })
  @IsOptional()
  @IsBoolean()
  noSimilarity?: boolean;

  @ApiPropertyOptional({ description: 'Leave the student out of the analytics at-risk lists' })
  @IsOptional()
  @IsBoolean()
  excludeFromAnalytics?: boolean;
}
