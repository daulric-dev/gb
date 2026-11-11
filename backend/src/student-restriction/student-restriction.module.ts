import { Module } from '@nestjs/common';
import { StudentRestrictionController } from './student-restriction.controller';
import { StudentRestrictionService } from './student-restriction.service';

/**
 * Per-student restriction flags (no AI, no similarity check, out of the
 * at-risk lists). AI, similarity and analytics honour them through the
 * helpers in restriction.ts, which need only Prisma.
 */
@Module({
  controllers: [StudentRestrictionController],
  providers: [StudentRestrictionService],
  exports: [StudentRestrictionService],
})
export class StudentRestrictionModule {}
