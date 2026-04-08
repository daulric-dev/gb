import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isGraded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
