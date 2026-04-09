import { IsUUID, IsNotEmpty, IsArray, ValidateNested, IsNumber, IsOptional, IsString, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

class GradeEntry {
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkGradeDto {
  @IsUUID()
  @IsNotEmpty()
  assessmentId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradeEntry)
  grades: GradeEntry[];
}