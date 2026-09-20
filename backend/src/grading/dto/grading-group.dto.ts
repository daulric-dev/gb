import {
  IsBoolean,
  IsInt,
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

export class ResolveSchemeQueryDto {
  @ApiProperty()
  @IsUUID()
  termId!: string;

  /** Omit for the term-wide default scheme every class inherits. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;
}

export class RemoveGradingGroupQueryDto {
  /** Same forking rule as an update: removing an inherited group forks first. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;
}

export class CreateGradingGroupDto {
  @ApiProperty()
  @IsUUID()
  termId!: string;

  /** Omit to edit the term-wide default rather than one class's scheme. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;

  @ApiProperty({ example: 'Assignments' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight!: number;

  /** The terminal exam. Year-end splits continuous work from this. */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isExam?: boolean;
}

export class UpdateGradingGroupDto {
  /**
   * The class being edited. Editing an inherited group with this set forks the
   * scheme to that class instead of changing the school's default.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentGroupId?: string;

  @ApiPropertyOptional({ example: 'Assignments' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isExam?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
