import { IsArray, ValidateNested, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class SubjectOrderItem {
  @IsString()
  id: string;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderSubjectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubjectOrderItem)
  items: SubjectOrderItem[];
}
