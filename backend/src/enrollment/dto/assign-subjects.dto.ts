import { IsUUID, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';

export class AssignSubjectsDto {
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  subjectIds: string[];
}
