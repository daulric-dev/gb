import { Module } from '@nestjs/common';
import { MasteryCourseController, MasterySchoolController, PortalMasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { OutcomeService } from './outcome.service';

/**
 * Mastery / standards-based grading, behind the `mastery` feature. Prisma,
 * features, permissions and course access are global. Exports
 * MasteryService for the parent portal and OutcomeService for the AI
 * course builder (src/ai). Evidence is written by `refreshOutcomeEvidence`
 * (outcome-evidence.ts), which the grading module calls wherever a mark is
 * written.
 */
@Module({
  controllers: [MasterySchoolController, MasteryCourseController, PortalMasteryController],
  providers: [MasteryService, OutcomeService],
  exports: [MasteryService, OutcomeService],
})
export class MasteryModule {}
