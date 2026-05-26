import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGradeScaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
