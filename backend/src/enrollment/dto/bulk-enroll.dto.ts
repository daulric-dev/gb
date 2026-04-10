import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class BulkEnrollDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  studentIds: string[];
}
