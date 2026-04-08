import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class BulkAssignSubjectsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  studentIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  subjectIds: string[];
}