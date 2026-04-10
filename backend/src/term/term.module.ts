import { Module } from '@nestjs/common';
import { TermService } from './term.service';
import { TermController } from './term.controller';

@Module({
  providers: [TermService],
  controllers: [TermController],
})
export class TermModule {}
