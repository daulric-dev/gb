import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { userSchoolId } from '@/common/user-school';
import type { StudentRestrictions } from './restriction';
import type { UpdateStudentRestrictionsDto } from './dto/update-restrictions.dto';

type Row = {
  no_ai: boolean;
  no_similarity: boolean;
  exclude_from_analytics: boolean;
  set_by: string | null;
  set_at: Date;
};

const SELECT = {
  no_ai: true,
  no_similarity: true,
  exclude_from_analytics: true,
  set_by: true,
  set_at: true,
} as const;

function view(row: Row | null): StudentRestrictions {
  return {
    noAi: row?.no_ai ?? false,
    noSimilarity: row?.no_similarity ?? false,
    excludeFromAnalytics: row?.exclude_from_analytics ?? false,
    setBy: row?.set_by ?? null,
    setAt: row?.set_at ? row.set_at.toISOString() : null,
  };
}

/**
 * Reading and changing a student's restriction flags (see restriction.ts).
 * The student must be in the caller's active school (404 otherwise). Every
 * change is audited (entity `student_restriction`), and switching a flag on
 * removes what it covers right away: similarity fingerprints (and so their
 * matches) for `no_similarity`, cached at-risk rows for
 * `exclude_from_analytics`.
 */
@Injectable()
export class StudentRestrictionService {
  private readonly logger = new Logger(StudentRestrictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private async studentInSchool(userId: string, studentId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    const student = await this.prisma.student
      .findFirst({ where: { id: studentId, school_id: schoolId }, select: { id: true } })
      .catch(() => null);
    if (!student) throw new NotFoundException('Student not found');
    return schoolId;
  }

  async get(userId: string, studentId: string): Promise<StudentRestrictions> {
    await this.studentInSchool(userId, studentId);
    const row = await this.prisma.student_restriction.findUnique({
      where: { student_id: studentId },
      select: SELECT,
    });
    return view(row);
  }

  async update(
    userId: string,
    studentId: string,
    dto: UpdateStudentRestrictionsDto,
  ): Promise<StudentRestrictions> {
    const schoolId = await this.studentInSchool(userId, studentId);
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.student_restriction.findUnique({
        where: { student_id: studentId },
        select: SELECT,
      });
      const next = {
        no_ai: dto.noAi ?? before?.no_ai ?? false,
        no_similarity: dto.noSimilarity ?? before?.no_similarity ?? false,
        exclude_from_analytics: dto.excludeFromAnalytics ?? before?.exclude_from_analytics ?? false,
      };
      const changes = auditChanges(
        {
          no_ai: before?.no_ai ?? false,
          no_similarity: before?.no_similarity ?? false,
          exclude_from_analytics: before?.exclude_from_analytics ?? false,
        },
        next,
      );
      if (Object.keys(changes).length === 0) return before;
      const saved = await tx.student_restriction.upsert({
        where: { student_id: studentId },
        create: { student_id: studentId, ...next, set_by: userId, set_at: new Date() },
        update: { ...next, set_by: userId, set_at: new Date() },
        select: SELECT,
      });
      await this.audit.record(tx, schoolId, { id: userId }, {
        entity: 'student_restriction',
        entityId: studentId,
        action: before ? 'update' : 'create',
        changes,
      });
      if (next.no_similarity && !before?.no_similarity) {
        // Matches go with their fingerprints (ON DELETE CASCADE).
        await tx.similarity_fingerprint.deleteMany({ where: { submission: { student_id: studentId } } });
      }
      if (next.exclude_from_analytics && !before?.exclude_from_analytics) {
        await tx.analytics_at_risk.deleteMany({ where: { student_id: studentId } });
      }
      return saved;
    });
    return view(row ?? null);
  }
}
