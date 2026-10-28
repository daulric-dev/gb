import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsInt,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

  /** Leave out each student's N marks that hurt the group most. */
  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  dropLowest?: number;

  /** Leave out each student's N best marks (after the lowest are dropped). */
  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  dropHighest?: number;
}

export class UpdateAssignmentGroupDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
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

  /** Leave out each student's N marks that hurt the group most. */
  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 50 })
  @ValidateIf((_, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  dropLowest?: number;

  /** Leave out each student's N best marks (after the lowest are dropped). */
  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 50 })
  @ValidateIf((_, v) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  dropHighest?: number;
}

export class ReorderAssignmentGroupsDto {
  /** Every group in the course, in the order they should show. */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  groupIds!: string[];
}
