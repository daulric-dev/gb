import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BandInputDto } from './band-input.dto';

export const GRADE_SCALE_TYPES = ['letter', 'gpa', 'pass_fail'] as const;
export type GradeScaleType = (typeof GRADE_SCALE_TYPES)[number];

export class CreateGradeScaleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsEnum(GRADE_SCALE_TYPES)
  scaleType!: GradeScaleType;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BandInputDto)
  bands!: BandInputDto[];
}
