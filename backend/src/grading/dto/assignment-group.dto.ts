import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateAssignmentGroupDto {
  @ApiProperty({ example: 'Quizzes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  /** Percent of the course total; omit or null for an unweighted course. */
  @ApiPropertyOptional({ example: 20, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight?: number | null;
}

export class UpdateAssignmentGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  /** null clears the weight. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight?: number | null;
}

export class ReorderAssignmentGroupsDto {
  /** Every group in the course, in the order they should show. */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  groupIds!: string[];
}
