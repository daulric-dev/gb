import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@/auth/auth.guard';
import { RequireStepUp } from '@/auth/step-up.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { RequirePermission } from '@/permission/require-permission.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { userSchoolId } from '@/common/user-school';
import { StudentErasureService } from '@/erasure/student-erasure.service';

/** At most this many student erasures per user per hour. */
export const ERASE_STUDENT_THROTTLE = { route: { limit: 20, ttl: 60 * 60 * 1000 } };

/**
 * Erasing a student record (`student:erase`): see StudentErasureService for
 * what goes. Scoped to the caller's active school.
 */
@ApiTags('Students')
@ApiBearerAuth()
@Controller('students')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentErasureController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erasure: StudentErasureService,
  ) {}

  private async school(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  /**
   * What erasing would do to the linked account, for the confirmation:
   * `{ account: 'none' | 'deleted' | 'unlinked' }`.
   */
  @RequirePermission('student', 'erase')
  @Get(':id/erasure-preview')
  async preview(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    const schoolId = await this.school(req.user.id as string);
    const student = await this.prisma.student.findFirst({
      where: { id, school_id: schoolId },
      select: { user_profile_id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return { account: await this.erasure.linkedAccountOutcome(student.user_profile_id, schoolId) };
  }

  /** Erase the student record for good (step-up). */
  @RequirePermission('student', 'erase')
  @RequireStepUp()
  @Throttle(ERASE_STUDENT_THROTTLE)
  @Delete(':id')
  async erase(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    const actor = req.user.id as string;
    return this.erasure.erase(id, {
      schoolId: await this.school(actor),
      actor,
      reason: 'admin',
    });
  }
}
