import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { AuditLogService, type AuditChanges } from '@/audit-log/audit-log.service';
import { InviteService } from '@/organisation/invite.service';
import { setSchoolMembership } from '@/common/school-membership';
import { permCacheKey } from '@/permission/permission.effective';
import { RosterClaimService } from './roster-claim.service';
import type { RosterSettings } from './roster-settings';
import type { FieldDiff, RosterEntity } from './roster-types';

/** A stored roster_change, as the apply reads it. */
export interface ChangeRow {
  id: string;
  entity: string;
  action: string;
  sourced_id: string;
  target_id: string | null;
  school_id: string | null;
  label: string;
  diff: unknown;
  data: unknown;
}

export interface ApplyContext {
  sourceId: string;
  /** Who applies (the admin, or the source's creator for scheduled runs); null skips the per-row audit. */
  actorId: string | null;
  settings: RosterSettings;
}

type Tx = Prisma.TransactionClient;
type Data = Record<string, unknown>;

const asDate = (v: unknown) => (typeof v === 'string' && v ? new Date(`${v}T00:00:00Z`) : null);
const obj = (v: unknown): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export class ApplyError extends Error {}

/**
 * Applies one roster_change. Each change commits in its own transaction
 * together with its link and its `applied` status, so a crash leaves every
 * change either fully applied or still pending (the run resumes from the
 * pending ones). Idempotent: a create whose link already points at a live
 * record updates that record instead; years, terms, enrolments and course
 * roles are found by their natural keys before anything is inserted. Writes
 * what the dry run showed (the diff's `to` values), never deletes a record:
 * a disable deactivates a student, archives a course, drops an enrolment,
 * removes a course role, or revokes a pending staff invite.
 */
@Injectable()
export class RosterApplyService {
  private readonly logger = new Logger(RosterApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly invites: InviteService,
    private readonly claims: RosterClaimService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async apply(change: ChangeRow, ctx: ApplyContext): Promise<void> {
    const entity = change.entity as RosterEntity;
    const data = obj(change.data);
    const diff = obj(change.diff) as FieldDiff;
    const after: (() => Promise<unknown>)[] = [];

    // Staff invites are sent outside the change's transaction (the invite
    // service has its own); an open one is reused on a retry.
    let inviteId: string | null = null;
    if (entity === 'staff' && change.action !== 'disable' && data.mode === 'invite') {
      inviteId = await this.ensureInvite(change, ctx, data);
    }

    await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.roster_change.findUnique({ where: { id: change.id }, select: { status: true } });
        if (fresh?.status !== 'pending') return; // applied by an earlier attempt
        let targetId: string | null;
        let auditAction: 'create' | 'update' = change.action === 'create' ? 'create' : 'update';
        if (change.action === 'disable') {
          targetId = await this.disable(tx, entity, change, ctx, after);
        } else {
          const out = await this.upsert(tx, entity, change, data, diff, ctx, after, inviteId);
          targetId = out.targetId;
          if (out.created === false) auditAction = 'update';
        }
        await tx.roster_change.update({
          where: { id: change.id },
          data: { status: 'applied', applied_at: new Date(), target_id: targetId, apply_error: null },
        });
        if (ctx.actorId && entity !== 'school') {
          await this.auditLog?.record(tx, change.school_id, { id: ctx.actorId }, {
            entity: `roster_${entity}`,
            entityId: targetId,
            action: auditAction,
            changes: toAudit(diff, change),
          });
        }
      },
      { timeout: 30_000 },
    );
    for (const fn of after) {
      try {
        await fn();
      } catch (err) {
        this.logger.warn(`After-apply step for change ${change.id} failed: ${(err as Error).message}`);
      }
    }
  }

  // --- links -----------------------------------------------------------------

  private async link(
    tx: Tx,
    ctx: ApplyContext,
    entity: RosterEntity,
    sourcedId: string,
    targetId: string,
    schoolId: string | null,
    extra: { email?: string | null; data?: Data } = {},
  ) {
    const now = new Date();
    const existing = await tx.roster_link.findUnique({
      where: { source_id_entity_sourced_id: { source_id: ctx.sourceId, entity, sourced_id: sourcedId } },
      select: { data: true },
    });
    const data = { ...obj(existing?.data), ...(extra.data ?? {}) } as Prisma.InputJsonObject;
    await tx.roster_link.upsert({
      where: { source_id_entity_sourced_id: { source_id: ctx.sourceId, entity, sourced_id: sourcedId } },
      create: {
        source_id: ctx.sourceId, entity, sourced_id: sourcedId, target_id: targetId, school_id: schoolId,
        email: extra.email ?? null, data,
      },
      update: {
        target_id: targetId, school_id: schoolId, disabled_at: null, updated_at: now, data,
        ...(extra.email !== undefined ? { email: extra.email } : {}),
      },
    });
  }

  private async linked(tx: Tx, ctx: ApplyContext, entity: RosterEntity, sourcedId: string) {
    return tx.roster_link.findUnique({
      where: { source_id_entity_sourced_id: { source_id: ctx.sourceId, entity, sourced_id: sourcedId } },
      select: { target_id: true, data: true, disabled_at: true },
    });
  }

  private async resolve(tx: Tx, ctx: ApplyContext, entity: RosterEntity, sourcedId: unknown, what: string) {
    if (typeof sourcedId !== 'string' || !sourcedId) return null;
    const l = await this.linked(tx, ctx, entity, sourcedId);
    if (!l) throw new ApplyError(`The ${what} was not created (see its own row)`);
    return l.target_id;
  }

  // --- create / update ---------------------------------------------------------

  private async upsert(
    tx: Tx,
    entity: RosterEntity,
    change: ChangeRow,
    data: Data,
    diff: FieldDiff,
    ctx: ApplyContext,
    after: (() => Promise<unknown>)[],
    inviteId: string | null,
  ): Promise<{ targetId: string | null; created?: boolean }> {
    const schoolId = str(data.schoolId) ?? change.school_id;
    const label = { label: change.label };
    const prior = await this.linked(tx, ctx, entity, change.sourced_id);
    switch (entity) {
      case 'academic_year': {
        if (!schoolId) throw new ApplyError('No school');
        let id = change.target_id ?? prior?.target_id ?? null;
        if (id && !(await tx.academic_year.findFirst({ where: { id, school_id: schoolId }, select: { id: true } }))) id = null;
        if (!id) {
          const byName = await tx.academic_year.findFirst({
            where: { school_id: schoolId, name: { equals: str(data.name) ?? '', mode: 'insensitive' } },
            select: { id: true },
          });
          id = byName?.id ?? null;
        }
        const fields = {
          name: str(data.name) ?? undefined,
          ...(data.startDate ? { start_date: asDate(data.startDate) } : {}),
          ...(data.endDate ? { end_date: asDate(data.endDate) } : {}),
        };
        let created = false;
        if (id) {
          await tx.academic_year.update({ where: { id }, data: fields, select: { id: true } });
        } else {
          id = (await tx.academic_year.create({ data: { school_id: schoolId, is_active: true, ...fields }, select: { id: true } })).id;
          created = true;
        }
        await this.link(tx, ctx, entity, change.sourced_id, id, schoolId, { data: label });
        return { targetId: id, created };
      }
      case 'term': {
        const yearId = await this.resolve(tx, ctx, 'academic_year', data.yearKey, 'academic year');
        if (!yearId) throw new ApplyError('The term has no academic year');
        let id = change.target_id ?? prior?.target_id ?? null;
        if (id && !(await tx.term.findFirst({ where: { id, academic_year_id: yearId }, select: { id: true } }))) id = null;
        if (!id) {
          const byName = await tx.term.findFirst({
            where: { academic_year_id: yearId, name: { equals: str(data.name) ?? '', mode: 'insensitive' } },
            select: { id: true },
          });
          id = byName?.id ?? null;
        }
        const fields = {
          name: str(data.name) ?? undefined,
          ...(data.startDate ? { start_date: asDate(data.startDate) } : {}),
          ...(data.endDate ? { end_date: asDate(data.endDate) } : {}),
        };
        let created = false;
        if (id) {
          await tx.term.update({ where: { id }, data: fields, select: { id: true } });
        } else {
          id = (await tx.term.create({ data: { academic_year_id: yearId, ...fields }, select: { id: true } })).id;
          created = true;
        }
        await this.link(tx, ctx, entity, change.sourced_id, id, schoolId, { data: label });
        return { targetId: id, created };
      }
      case 'course': {
        if (!schoolId) throw new ApplyError('No school');
        const yearId = await this.resolve(tx, ctx, 'academic_year', data.yearKey, 'academic year');
        const termId = await this.resolve(tx, ctx, 'term', data.termKey, 'term');
        let id = change.target_id ?? prior?.target_id ?? null;
        const existing = id
          ? await tx.course.findFirst({ where: { id, school_id: schoolId }, select: { id: true, status: true } })
          : null;
        const fields = {
          name: str(data.name) ?? 'Untitled class',
          code: str(data.code),
          academic_year_id: yearId,
          term_id: termId,
        };
        if (existing) {
          const status = diff.status?.to;
          await tx.course.update({
            where: { id: existing.id },
            data: {
              ...fields,
              ...(typeof status === 'string' && ['draft', 'published'].includes(status) ? { status: status as 'draft' | 'published' } : {}),
              updated_at: new Date(),
            },
            select: { id: true },
          });
          await this.link(tx, ctx, entity, change.sourced_id, existing.id, schoolId, { data: label });
          return { targetId: existing.id, created: false };
        }
        id = (await tx.course.create({
          data: { school_id: schoolId, status: 'draft', ...fields },
          select: { id: true },
        })).id;
        await this.link(tx, ctx, entity, change.sourced_id, id, schoolId, { data: label });
        return { targetId: id, created: true };
      }
      case 'student': {
        if (!schoolId) throw new ApplyError('No school');
        const email = str(data.email);
        let id = change.target_id ?? prior?.target_id ?? null;
        const existing = id
          ? await tx.student.findFirst({ where: { id, school_id: schoolId }, select: { id: true, user_profile_id: true } })
          : null;
        if (existing) {
          const set: Prisma.studentUpdateInput = {};
          if (diff.firstName) set.first_name = str(diff.firstName.to);
          if (diff.lastName) set.last_name = str(diff.lastName.to);
          if (diff.dateOfBirth) set.date_of_birth = asDate(diff.dateOfBirth.to);
          if (diff.studentNumber) set.student_number = str(diff.studentNumber.to);
          if (diff.isActive?.to === true) set.is_active = true;
          if (Object.keys(set).length) await tx.student.update({ where: { id: existing.id }, data: set, select: { id: true } });
          await this.link(tx, ctx, entity, change.sourced_id, existing.id, schoolId, { email, data: label });
          after.push(() => this.dropStudentCaches(schoolId, existing.user_profile_id));
          if (email && !existing.user_profile_id) after.push(() => this.claims.claimExisting(email));
          return { targetId: existing.id, created: false };
        }
        id = (await tx.student.create({
          data: {
            school_id: schoolId,
            first_name: str(data.firstName),
            last_name: str(data.lastName),
            date_of_birth: asDate(data.dateOfBirth),
            student_number: str(data.studentNumber),
            enrollment_date: new Date(new Date().toISOString().slice(0, 10)),
            is_active: true,
          },
          select: { id: true },
        })).id;
        await this.link(tx, ctx, entity, change.sourced_id, id, schoolId, { email, data: label });
        after.push(() => this.dropStudentCaches(schoolId, null));
        if (email) {
          after.push(async () => {
            const linkedTo = await this.claims.claimExisting(email);
            if (!linkedTo && ctx.settings.notifyStudents) await this.claims.notifyStudent(email, schoolId);
          });
        }
        return { targetId: id, created: true };
      }
      case 'staff': {
        if (!schoolId) throw new ApplyError('No school');
        const email = str(data.email);
        const mode = str(data.mode);
        if (mode === 'invite' || mode === 'invite-existing') {
          const target = inviteId ?? str(data.inviteId) ?? change.target_id;
          if (!target) throw new ApplyError('No invite');
          await this.link(tx, ctx, entity, change.sourced_id, target, schoolId, { email, data: { ...label, pending: true } });
          return { targetId: target, created: mode === 'invite' };
        }
        const userId = str(data.userId) ?? change.target_id;
        if (!userId) throw new ApplyError('No account');
        let created = false;
        if (mode === 'membership') {
          const member = await tx.school_management.findUnique({
            where: { user_id_school_id: { user_id: userId, school_id: schoolId } },
            select: { id: true },
          });
          if (!member) {
            const profile = await tx.user_profile.findUnique({ where: { id: userId }, select: { school_id: true, account_type: true } });
            if (!profile) throw new ApplyError('The account has no profile yet; it is added after their first sign-in');
            if (profile.account_type !== 'staff') throw new ApplyError(`This is a ${profile.account_type} account`);
            // Always a teacher: rostering never makes anyone an admin.
            await setSchoolMembership(tx, userId, schoolId, 'teacher');
            if (!profile.school_id) {
              await tx.user_profile.update({ where: { id: userId }, data: { school_id: schoolId, role: 'teacher', is_active: true } });
            }
            created = true;
            after.push(() => Promise.all([this.cache.delete(`profile:${userId}`), this.cache.delete(permCacheKey(userId, schoolId))]));
          }
        }
        await this.link(tx, ctx, entity, change.sourced_id, userId, schoolId, { email, data: { ...label, pending: false } });
        return { targetId: userId, created };
      }
      case 'enrolment': {
        const courseId = await this.resolve(tx, ctx, 'course', data.classSourcedId, 'class');
        const studentId = await this.resolve(tx, ctx, 'student', data.userSourcedId, 'student');
        if (!courseId || !studentId) throw new ApplyError('The class or the student is missing');
        const existing = await tx.course_student.findUnique({
          where: { course_id_student_id: { course_id: courseId, student_id: studentId } },
          select: { id: true, status: true },
        });
        let id: string;
        if (existing) {
          if (existing.status !== 'active' && (diff.status?.to === 'active' || change.action === 'create')) {
            await tx.course_student.update({ where: { id: existing.id }, data: { status: 'active' }, select: { id: true } });
          }
          id = existing.id;
        } else {
          id = (await tx.course_student.create({
            data: { course_id: courseId, student_id: studentId, status: 'active' },
            select: { id: true },
          })).id;
        }
        await this.link(tx, ctx, entity, change.sourced_id, id, schoolId, { data: label });
        return { targetId: id, created: !existing };
      }
      case 'course_staff': {
        const courseId = await this.resolve(tx, ctx, 'course', data.classSourcedId, 'class');
        const userId = str(data.userId);
        if (!courseId || !userId) throw new ApplyError('The class or the teacher is missing');
        const role = data.role === 'ta' ? 'ta' : 'teacher';
        const row = await tx.course_staff.upsert({
          where: { course_id_user_profile_id: { course_id: courseId, user_profile_id: userId } },
          create: { course_id: courseId, user_profile_id: userId, role },
          update: { role },
          select: { id: true },
        });
        await this.link(tx, ctx, entity, change.sourced_id, row.id, schoolId, { data: label });
        return { targetId: row.id };
      }
      default:
        throw new ApplyError(`Nothing to apply for ${entity}`);
    }
  }

  private async ensureInvite(change: ChangeRow, ctx: ApplyContext, data: Data): Promise<string> {
    const schoolId = str(data.schoolId) ?? change.school_id;
    const email = str(data.email);
    if (!schoolId || !email) throw new ApplyError('No school or email for the invite');
    const open = await this.prisma.organisation_invite.findFirst({
      where: { kind: 'school_staff', school_id: schoolId, email, accepted_at: null, revoked_at: null },
      select: { id: true },
    });
    if (open) return open.id;
    if (!ctx.actorId) throw new ApplyError('No one to send the invite from');
    const invite = await this.invites.invite(ctx.actorId, 'school_staff', email, schoolId, {
      sendEmail: ctx.settings.sendStaffInvites,
    });
    return invite.id;
  }

  // --- disable ---------------------------------------------------------------

  private async disable(
    tx: Tx,
    entity: RosterEntity,
    change: ChangeRow,
    ctx: ApplyContext,
    after: (() => Promise<unknown>)[],
  ): Promise<string | null> {
    const target = change.target_id;
    if (!target) throw new ApplyError('Nothing to disable');
    const now = new Date();
    let extra: Data = {};
    switch (entity) {
      case 'student': {
        const s = await tx.student.findUnique({ where: { id: target }, select: { user_profile_id: true, school_id: true } });
        if (s) {
          await tx.student.update({ where: { id: target }, data: { is_active: false }, select: { id: true } });
          after.push(() => this.dropStudentCaches(s.school_id, s.user_profile_id));
        }
        break;
      }
      case 'course': {
        const c = await tx.course.findUnique({ where: { id: target }, select: { status: true } });
        if (c && c.status !== 'archived') {
          extra = { statusBeforeDisable: c.status };
          await tx.course.update({ where: { id: target }, data: { status: 'archived', updated_at: now }, select: { id: true } });
        }
        break;
      }
      case 'enrolment':
        await tx.course_student.updateMany({ where: { id: target, status: 'active' }, data: { status: 'dropped' } });
        break;
      case 'course_staff': {
        const row = await tx.course_staff.findUnique({ where: { id: target }, select: { course_id: true, role: true } });
        if (row) {
          if (row.role === 'teacher') {
            const teachers = await tx.course_staff.count({ where: { course_id: row.course_id, role: 'teacher' } });
            if (teachers <= 1) throw new ApplyError('The last teacher of a course is kept; add another teacher first');
          }
          await tx.course_staff.delete({ where: { id: target } });
        }
        break;
      }
      case 'staff':
        // A pending invite is revoked; an account keeps its membership (an
        // admin removes staff by hand), its rostered course roles go with
        // their own course_staff rows.
        await tx.organisation_invite.updateMany({
          where: { id: target, kind: 'school_staff', accepted_at: null, revoked_at: null },
          data: { revoked_at: now },
        });
        break;
      default:
        throw new ApplyError(`${entity} is never disabled`);
    }
    await tx.roster_link.updateMany({
      where: { source_id: ctx.sourceId, entity, sourced_id: change.sourced_id, disabled_at: null },
      data: { disabled_at: now, updated_at: now },
    });
    if (Object.keys(extra).length) {
      const links = await tx.roster_link.findMany({
        where: { source_id: ctx.sourceId, entity, sourced_id: change.sourced_id },
        select: { id: true, data: true },
      });
      for (const l of links) {
        await tx.roster_link.update({
          where: { id: l.id },
          data: { data: { ...obj(l.data), ...extra } as Prisma.InputJsonObject },
        });
      }
    }
    return target;
  }

  private async dropStudentCaches(schoolId: string | null, userProfileId: string | null) {
    await Promise.all([
      schoolId ? this.cache.delete(`students:${schoolId}`) : null,
      userProfileId ? this.cache.delete(`student-context:${userProfileId}`) : null,
      userProfileId ? this.cache.delete(`profile:${userProfileId}`) : null,
    ]);
  }
}

function toAudit(diff: FieldDiff, change: ChangeRow): AuditChanges {
  const out: AuditChanges = {};
  for (const [k, v] of Object.entries(diff)) out[k] = { before: v.from, after: v.to };
  out.roster_source_record = { before: null, after: change.sourced_id };
  return out;
}
