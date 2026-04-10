import { Module } from '@nestjs/common';
import { SubjectService } from './subject.service';
import { SubjectController } from './subject.controller';

@Module({
  providers: [SubjectService],
  controllers: [SubjectController],
})
export class SubjectModule {}
