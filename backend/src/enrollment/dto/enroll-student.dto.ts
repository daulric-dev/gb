import { IsUUID, IsNotEmpty } from 'class-validator';

export class EnrollStudentDto {
  @IsUUID()
  @IsNotEmpty()
  studentId: string;
}