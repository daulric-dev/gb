import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '@/prisma/prisma.service';
import { isLastStoredOrgAdmin } from '@/organisation/org-admin';

/** The stable `code` of the 409 that refuses `DELETE /auth/account`. */
export const ACCOUNT_DELETION_BLOCKED = 'ACCOUNT_DELETION_BLOCKED';

export type DeletionBlockerCode =
  | 'ORG_OWNER'
  | 'LAST_ORG_ADMIN'
  | 'SCHOOL_OWNER'
  | 'SCHOOL_ADMIN'
  | 'SSO_STUDENT';

/**
 * What the user can do about a blocker. Clients map it to their own screens
 * (the web links to the transfer forms; mobile explains, transfers are on
 * the web).
 */
export type DeletionBlockerAction =
  | { type: 'transfer_organisation_ownership' }
  | { type: 'add_organisation_admin' }
  | { type: 'transfer_school_ownership'; schoolId: string; schoolName: string }
  | { type: 'contact_school' };

export interface DeletionBlocker {
  code: DeletionBlockerCode;
  message: string;
  action?: DeletionBlockerAction;
}

export interface DeletionCheck {
  canDelete: boolean;
  blockers: DeletionBlocker[];
}

export const ORG_OWNER_MESSAGE =
  'Transfer ownership of the organisation before deleting your account';
export const LAST_ORG_ADMIN_MESSAGE =
  "You're the organisation's last administrator. Add another administrator before deleting your account.";

export const schoolOwnerMessage = (school: string) =>
  `Transfer ownership of ${school} before deleting your account`;

export const schoolAdminMessage = (school: string) =>
  `You're the only administrator of ${school}. Hand the school over to another staff member before deleting your account`;

export const ssoStudentMessage = (provider: string) =>
  `Your account is managed by your school through ${provider}. Ask your school to remove it.`;

/**
 * Sign-in providers as people know them (src/sso/adapters ids). Email-code
 * sign-in never writes an account.identity row; 'email' is listed only so a
 * row like that would never count as single sign-on.
 */
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  azure: 'Microsoft',
  microsoft: 'Microsoft',
  saml: "your school's single sign-on",
};
const NOT_SSO = new Set(['email', 'email_code', 'otp']);

export function isSsoProvider(provider: string): boolean {
  return !NOT_SSO.has(provider.toLowerCase());
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? "your school's sign-in provider";
}

const schoolName = (name: string | null | undefined) => name?.trim() || 'your school';

/**
 * Why this account cannot be deleted right now (empty = it can). Read by
 * `GET /auth/account/deletion-check` and enforced by `deleteAccount` before
 * anything is touched, so the owner foreign keys (Restrict) never fire.
 *
 * - ORG_OWNER: they own the organisation (organisation.owner_id).
 * - LAST_ORG_ADMIN: they hold the only stored organisation_admin row.
 * - SCHOOL_OWNER: one per school they own (school.owner_id).
 * - SCHOOL_ADMIN: they hold the admin seat of a school with no owner that
 *   still has other staff or students, which would be left with nobody to
 *   run it (a school has one admin; see seatSchoolAdmin).
 * - SSO_STUDENT: a student account (account_type 'student' or a linked
 *   student record) that signs in through school single sign-on: the school
 *   provisioned it, so the school removes it. Staff and parents with SSO,
 *   and email-code students, delete their own accounts.
 */
export async function accountDeletionCheck(
  prisma: PrismaService,
  userId: string,
): Promise<DeletionCheck> {
  const [ownedOrg, lastAdmin, ownedSchools, adminSeats, profile, studentRow, identities] =
    await Promise.all([
      prisma.organisation.findFirst({
        where: { owner_id: userId },
        select: { id: true },
      }),
      isLastStoredOrgAdmin(prisma, userId),
      prisma.school.findMany({
        where: { owner_id: userId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.school_management.findMany({
        where: { user_id: userId, role: 'admin' },
        select: {
          school_id: true,
          school: { select: { id: true, name: true, owner_id: true } },
        },
      }),
      prisma.user_profile.findUnique({
        where: { id: userId },
        select: { account_type: true },
      }),
      prisma.student.findFirst({
        where: { user_profile_id: userId },
        select: { id: true },
      }),
      prisma.identity.findMany({
        where: { user_id: userId },
        select: { provider: true },
        orderBy: { last_used_at: 'desc' },
      }),
    ]);

  const blockers: DeletionBlocker[] = [];

  if (ownedOrg) {
    blockers.push({
      code: 'ORG_OWNER',
      message: ORG_OWNER_MESSAGE,
      action: { type: 'transfer_organisation_ownership' },
    });
  }
  if (lastAdmin) {
    blockers.push({
      code: 'LAST_ORG_ADMIN',
      message: LAST_ORG_ADMIN_MESSAGE,
      action: { type: 'add_organisation_admin' },
    });
  }
  for (const school of ownedSchools) {
    const name = schoolName(school.name);
    blockers.push({
      code: 'SCHOOL_OWNER',
      message: schoolOwnerMessage(name),
      action: { type: 'transfer_school_ownership', schoolId: school.id, schoolName: name },
    });
  }

  // An admin seat only blocks when the school has no owner to fall back on
  // (an owner is covered above when it is them, and otherwise still runs
  // the school) and somebody else is still in it.
  for (const seat of adminSeats) {
    if (!seat.school || seat.school.owner_id) continue;
    const [staff, students] = await Promise.all([
      prisma.school_management.count({
        where: { school_id: seat.school_id, user_id: { not: userId } },
      }),
      prisma.student.count({ where: { school_id: seat.school_id } }),
    ]);
    if (staff + students === 0) continue;
    const name = schoolName(seat.school.name);
    blockers.push({
      code: 'SCHOOL_ADMIN',
      message: schoolAdminMessage(name),
      action: { type: 'transfer_school_ownership', schoolId: seat.school_id, schoolName: name },
    });
  }

  const isStudent = profile?.account_type === 'student' || !!studentRow;
  const sso = identities.find((i) => isSsoProvider(i.provider));
  if (isStudent && sso) {
    blockers.push({
      code: 'SSO_STUDENT',
      message: ssoStudentMessage(providerLabel(sso.provider)),
      action: { type: 'contact_school' },
    });
  }

  return { canDelete: blockers.length === 0, blockers };
}

/**
 * 409 `{ statusCode, code: 'ACCOUNT_DELETION_BLOCKED', message, blockers }`.
 * `message` is the first blocker's, so a client that only shows messages
 * still says something useful.
 */
export class AccountDeletionBlockedException extends ConflictException {
  constructor(readonly blockers: DeletionBlocker[]) {
    const more = blockers.length - 1;
    super({
      statusCode: 409,
      code: ACCOUNT_DELETION_BLOCKED,
      message:
        more > 0
          ? `${blockers[0].message} (and ${more} more thing${more === 1 ? '' : 's'} to sort out first)`
          : blockers[0].message,
      blockers,
    });
  }
}
