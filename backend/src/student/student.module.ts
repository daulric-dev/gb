import { Module } from '@nestjs/common';
import { StudentService } from './student.service';
import { StudentController } from './student.controller';
import { StudentErasureController } from './student-erasure.controller';

@Module({
  providers: [StudentService],
  controllers: [StudentController, StudentErasureController],
})
export class StudentModule {}
