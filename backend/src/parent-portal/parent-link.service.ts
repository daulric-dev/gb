import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { MailService } from '@/mail/mail.service';
import { FeatureService } from '@/features/feature.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import { userSchoolId } from '@/common/user-school';
import { primaryOrigin } from '@/config/origins';
import { isOrgAdmin } from '@/organisation/org-admin';
import { loadEffectivePermissions, userPermCachePrefix } from '@/permission/permission.effective';
import { canSeeSensitive, scopedStudentWhere, studentScope } from '@/permission/student-access';
import { parentInviteEmail } from './parent-emails';
import { excludedByAge, parseParentSettings } from './parent-settings';
import {
  INVITE_TTL_DAYS,
  LINK_CODE_TTL_DAYS,
  daysFrom,
  hashInviteToken,
  hashLinkCode,
  newInviteToken,
  newLinkCode,
} from './parent-token';
import type {
  AcceptParentInviteDto,
  CreateLinkCodeDto,
  InviteParentDto,
  RedeemLinkCodeDto,
} from './dto/parent.dto';

/** Wrong link codes one account may try per window. */
export const MAX_FAILED_CODES = 10;
export const FAILED_CODE_WINDOW_S = 60 * 60;
const failedCodeKey = (userId: string) => `parent-link:failed-code:${userId}`;

export const ACCOUNT_NOT_ELIGIBLE = 'ACCOUNT_NOT_ELIGIBLE';
export const INVITE_INVALID = 'INVITE_INVALID';

type Invite = {
  id: string;
  student_id: string;
  school_id: string;
  kind: string;
  email: string | null;
  relationship: 'mother' | 'father' | 'guardian' | null;
  relationship_label: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_by: string | null;
};

const INVITE_SELECT = {
  id: true,
  student_id: true,
  school_id: true,
  kind: true,
  email: true,
  relationship: true,
  relationship_label: true,
  expires_at: true,
  used_at: true,
  revoked_at: true,
  created_by: true,
} satisfies Prisma.parent_inviteSelect;

function inviteGone(): GoneException {
  return new GoneException({
    statusCode: 410,
    code: INVITE_INVALID,
    message: 'This invitation has already been used, was withdrawn or has expired. Ask the school for a new one.',
  });
}

function notEligible(message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code: ACCOUNT_NOT_ELIGIBLE, message });
}

const label = (v: string | undefined | null) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Links between parents and students: staff invite a parent by email or hand
 * over a one-time code, list and remove links; a signed-in user redeems an
 * invitation and becomes (or stays) a parent account.
 */
@Injectable()
export class ParentLinkService {
  private readonly logger = new Logger(ParentLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly features: FeatureService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  // ── staff ────────────────────────────────────────────────────────────────

  /**
   * The student in the caller's active school and within their student scope
   * (permission/student-access.ts: every student with student:read-all,
   * otherwise their courses' and tutor group's), or 404.
   */
  private async studentInSchool(userId: string, studentId: string) {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new ForbiddenException('You are not assigned to a school');
    const effective = await loadEffectivePermissions(this.prisma, this.cache, userId, schoolId);
    const student = await this.prisma.student
      .findFirst({
        where: scopedStudentWhere(studentScope(effective, userId, schoolId), {
          id: studentId,
          school_id: schoolId,
        }),
        select: {
          id: true,
          first_name: true,
          last_name: true,
          school: { select: { name: true } },
        },
      })
      .catch(() => null);
    if (!student) throw new NotFoundException('Student not found');
    return { student, schoolId, sensitive: canSeeSensitive(effective) };
  }

  /**
   * The student's parents and open invitations. Parent and invitation email
   * addresses are guardian contacts: null without student:sensitive.
   */
  async listForStudent(userId: string, studentId: string) {
    const { sensitive } = await this.studentInSchool(userId, studentId);
    const now = new Date();
    const [links, invites] = await Promise.all([
      this.prisma.parent_student_link.findMany({
        where: { student_id: studentId },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          relationship: true,
          relationship_label: true,
          created_at: true,
          user_profile: {
            select: { id: true, first_name: true, last_name: true, email: true },
          },
        },
      }),
      this.prisma.parent_invite.findMany({
        where: { student_id: studentId, used_at: null, revoked_at: null, expires_at: { gt: now } },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          kind: true,
          email: true,
          relationship: true,
          relationship_label: true,
          expires_at: true,
          created_at: true,
        },
      }),
    ]);
    return {
      links: links.map((l) => ({
        id: l.id,
        parent: {
          id: l.user_profile.id,
          firstName: l.user_profile.first_name,
          lastName: l.user_profile.last_name,
          email: sensitive ? l.user_profile.email : null,
        },
        relationship: l.relationship,
        relationshipLabel: l.relationship_label,
        createdAt: l.created_at.toISOString(),
      })),
      invites: invites.map((i) => ({
        id: i.id,
        kind: i.kind as 'email' | 'code',
        email: sensitive ? i.email : null,
        relationship: i.relationship,
        relationshipLabel: i.relationship_label,
        expiresAt: i.expires_at.toISOString(),
        createdAt: i.created_at.toISOString(),
      })),
    };
  }

  /** Email an invitation link (bound to that address) for this student. */
  async invite(userId: string, studentId: string, dto: InviteParentDto) {
    const { student, schoolId } = await this.studentInSchool(userId, studentId);
    const email = dto.email.trim().toLowerCase();

    const already = await this.prisma.parent_student_link.findFirst({
      where: { student_id: studentId, user_profile: { email: { equals: email, mode: 'insensitive' } } },
      select: { id: true },
    });
    if (already) throw new ConflictException('That parent is already linked to this student');

    const token = newInviteToken();
    const now = new Date();
    const expiresAt = daysFrom(now, INVITE_TTL_DAYS);

    const created = await this.prisma.$transaction(async (tx) => {
      // A fresh invitation replaces any open one for the same address.
      await tx.parent_invite.updateMany({
        where: { student_id: studentId, kind: 'email', email, used_at: null, revoked_at: null },
        data: { revoked_at: now },
      });
      const row = await tx.parent_invite.create({
        data: {
          student_id: studentId,
          school_id: schoolId,
          kind: 'email',
          email,
          token_hash: hashInviteToken(token),
          relationship: dto.relationship ?? null,
          relationship_label: label(dto.relationshipLabel),
          expires_at: expiresAt,
          created_by: userId,
        },
        select: { id: true },
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'parent_invite',
        entityId: row.id,
        action: 'create',
        changes: auditChanges(null, { student_id: studentId, kind: 'email', email }),
      });
      return row;
    });

    const childName = [student.first_name, student.last_name].filter(Boolean).join(' ') || 'your child';
    try {
      await this.mail.send({
        to: email,
        ...parentInviteEmail({
          schoolName: student.school?.name ?? 'Your school',
          childName,
          acceptUrl: `${primaryOrigin()}/parent/accept?token=${encodeURIComponent(token)}`,
          expiresAt,
        }),
      });
    } catch (err) {
      this.logger.error(`Parent invite email failed: ${(err as Error).message}`);
      // An invitation nobody received is no use: withdraw it.
      await this.prisma.parent_invite
        .update({ where: { id: created.id }, data: { revoked_at: new Date() } })
        .catch(() => undefined);
      throw new ServiceUnavailableException('The invitation email could not be sent. Try again later.');
    }

    return { id: created.id, kind: 'email' as const, email, expiresAt: expiresAt.toISOString() };
  }

  /** A one-time code staff hand to a parent. Shown once; only its hash is kept. */
  async createLinkCode(userId: string, studentId: string, dto: CreateLinkCodeDto) {
    const { schoolId } = await this.studentInSchool(userId, studentId);
    const code = newLinkCode();
    const expiresAt = daysFrom(new Date(), LINK_CODE_TTL_DAYS);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.parent_invite.create({
        data: {
          student_id: studentId,
          school_id: schoolId,
          kind: 'code',
          token_hash: hashLinkCode(code),
          relationship: dto.relationship ?? null,
          relationship_label: label(dto.relationshipLabel),
          expires_at: expiresAt,
          created_by: userId,
        },
        select: { id: true },
      });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'parent_invite',
        entityId: r.id,
        action: 'create',
        changes: auditChanges(null, { student_id: studentId, kind: 'code' }),
      });
      return r;
    });
    return { id: row.id, kind: 'code' as const, code, expiresAt: expiresAt.toISOString() };
  }

  async revokeInvite(userId: string, studentId: string, inviteId: string) {
    const { schoolId } = await this.studentInSchool(userId, studentId);
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.parent_invite.updateMany({
        where: { id: inviteId, student_id: studentId, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      if (r.count === 1) {
        await this.auditLog?.record(tx, schoolId, { id: userId }, {
          entity: 'parent_invite',
          entityId: inviteId,
          action: 'delete',
          changes: auditChanges({ student_id: studentId }, null),
        });
      }
      return r;
    });
    if (res.count !== 1) throw new NotFoundException('Invitation not found');
    return { revoked: true };
  }

  async removeLink(userId: string, studentId: string, linkId: string) {
    const { schoolId } = await this.studentInSchool(userId, studentId);
    const removed = await this.prisma.$transaction(async (tx) => {
      const link = await tx.parent_student_link.findFirst({
        where: { id: linkId, student_id: studentId },
        select: { id: true, user_profile_id: true },
      });
      if (!link) return null;
      await tx.parent_student_link.delete({ where: { id: link.id } });
      await this.auditLog?.record(tx, schoolId, { id: userId }, {
        entity: 'parent_student_link',
        entityId: link.id,
        action: 'delete',
        changes: auditChanges({ student_id: studentId, parent_id: link.user_profile_id }, null),
      });
      return link;
    });
    if (!removed) throw new NotFoundException('Link not found');
    return { removed: true };
  }

  // ── parent ───────────────────────────────────────────────────────────────

  /** Redeem an emailed invitation; the signed-in address must be the invited one. */
  async accept(user: { id: string; email?: string }, dto: AcceptParentInviteDto) {
    const invite = await this.prisma.parent_invite.findUnique({
      where: { token_hash: hashInviteToken(dto.token) },
      select: INVITE_SELECT,
    });
    if (!invite || invite.kind !== 'email') throw inviteGone();
    if (!user.email || invite.email !== user.email.trim().toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address. Sign in with that address to accept it.',
      );
    }
    return this.redeem(user.id, invite, dto);
  }

  /** Redeem a one-time code from the school. Wrong codes count per account. */
  async redeemCode(user: { id: string }, dto: RedeemLinkCodeDto) {
    const key = failedCodeKey(user.id);
    const failures = Number((await this.cache.get(key)) ?? 0);
    if (failures >= MAX_FAILED_CODES) {
      throw new HttpException(
        'Too many wrong codes. Try again later or ask the school for a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const invite = await this.prisma.parent_invite.findUnique({
      where: { token_hash: hashLinkCode(dto.code) },
      select: INVITE_SELECT,
    });
    if (!invite || invite.kind !== 'code') {
      await this.cache.incr(key, FAILED_CODE_WINDOW_S).catch(() => undefined);
      throw new NotFoundException('That code is not right. Check it and try again');
    }
    return this.redeem(user.id, invite, dto);
  }

  private async redeem(
    userId: string,
    invite: Invite,
    names: { firstName?: string; lastName?: string },
  ) {
    const now = new Date();
    if (invite.used_at || invite.revoked_at || invite.expires_at.getTime() <= now.getTime()) {
      throw inviteGone();
    }
    await this.features.assertEnabled(invite.school_id, 'parent_portal');

    const student = await this.prisma.student.findUnique({
      where: { id: invite.student_id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        is_active: true,
        school_id: true,
        date_of_birth: true,
        school: { select: { name: true, parent_settings: true } },
      },
    });
    if (!student || student.is_active === false || student.school_id !== invite.school_id) {
      throw inviteGone();
    }
    if (excludedByAge(parseParentSettings(student.school?.parent_settings), student.date_of_birth)) {
      throw new ForbiddenException('The school does not offer the parent portal for this student');
    }

    const profile = await this.eligibleProfile(userId);
    const firstName = names.firstName?.trim() || null;
    if (!profile?.first_name && !firstName) {
      throw new BadRequestException('Tell us your name to finish setting up your account');
    }

    await this.prisma.$transaction(async (tx) => {
      // Claim first: a concurrent redeem of the same token finds it used.
      const claimed = await tx.parent_invite.updateMany({
        where: { id: invite.id, used_at: null, revoked_at: null, expires_at: { gt: now } },
        data: { used_at: now, used_by: userId },
      });
      if (claimed.count !== 1) throw inviteGone();

      const nameData = firstName
        ? { first_name: firstName, last_name: names.lastName?.trim() ?? '' }
        : {};
      if (profile) {
        await tx.user_profile.update({
          where: { id: userId },
          data: { account_type: 'parent', role: null, school_id: null, ...nameData, updated_at: now },
        });
      } else {
        const user = await tx.app_user.findUnique({ where: { id: userId }, select: { email: true } });
        await tx.user_profile.create({
          data: { id: userId, email: user?.email ?? null, account_type: 'parent', ...nameData },
        });
      }

      const existing = await tx.parent_student_link.findFirst({
        where: { user_profile_id: userId, student_id: invite.student_id },
        select: { id: true },
      });
      if (!existing) {
        const link = await tx.parent_student_link.create({
          data: {
            user_profile_id: userId,
            student_id: invite.student_id,
            relationship: invite.relationship,
            relationship_label: invite.relationship_label,
            created_by: invite.created_by,
          },
          select: { id: true },
        });
        await this.auditLog?.record(tx, invite.school_id, { id: userId }, {
          entity: 'parent_student_link',
          entityId: link.id,
          action: 'create',
          changes: auditChanges(null, {
            student_id: invite.student_id,
            parent_id: userId,
            via: invite.kind,
          }),
        });
      }
    });

    await this.cache.delete(`profile:${userId}`);
    await this.cache.deleteByPrefix(userPermCachePrefix(userId)).catch(() => undefined);

    return {
      studentId: student.id,
      child: { firstName: student.first_name, lastName: student.last_name },
      school: { name: student.school?.name ?? null },
    };
  }

  /**
   * The caller's profile if it may become (or already is) a parent account,
   * null when there is none yet. A parent account stays one; a blank staff
   * profile (signed in, never joined a school) turns into one. Students,
   * staff with a school or a pending request, and organisation admins are
   * refused: one account is one kind of user, which keeps every guard
   * correct. They can accept with a different email address.
   */
  private async eligibleProfile(userId: string) {
    const profile = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { account_type: true, school_id: true, first_name: true, is_active: true },
    });
    if (!profile) return null;
    if (profile.is_active === false) throw new ForbiddenException('Account is deactivated');
    if (profile.account_type === 'parent') return profile;
    if (profile.account_type === 'student') {
      throw notEligible(
        'This is a student account. Sign in with a different email address to use the parent portal.',
      );
    }
    const [memberships, studentRow, pending, orgAdmin] = await Promise.all([
      this.prisma.school_management.count({ where: { user_id: userId } }),
      this.prisma.student.count({ where: { user_profile_id: userId } }),
      this.prisma.school_join_request.count({ where: { user_id: userId, status: 'pending' } }),
      isOrgAdmin(this.prisma, userId).catch(() => false),
    ]);
    if (profile.school_id || memberships > 0 || studentRow > 0 || pending > 0 || orgAdmin) {
      throw notEligible(
        'This is a staff account. Sign in with a different email address to use the parent portal.',
      );
    }
    return profile;
  }
}
