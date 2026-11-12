import type { Collector } from '../data-export.types';
import { day, fullName, personNames, schoolNames } from './helpers';

/** Account-level collectors run only when the subject has an account and `accountData` is set. */
const hasAccount = (ctx: { subject: { userId: string | null; accountData: boolean } }) =>
  !!ctx.subject.userId && ctx.subject.accountData;

export const profileCollector: Collector = {
  id: 'profile',
  title: 'Profile',
  description:
    'The account (email address, name, role, picture, when it was created and last signed in), the student record and its processing restrictions (name, date of birth, gender, school, student number, enrolment date, form tutor, and opt-outs).',
  covers: [
    'public.user_profile.id',
    'student.student.user_profile_id',
    'student.student.form_tutor_id',
    'student.student_restriction.student_id',
  ],
  scopes: ['self', 'staff', 'parent'],
  async collect(ctx) {
    const { prisma, subject } = ctx;
    const account =
      subject.userId && subject.scope !== 'parent'
        ? await prisma.user_profile.findUnique({
            where: { id: subject.userId },
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              role: true,
              account_type: true,
              avatar_url: true,
              is_active: true,
              school_id: true,
              created_at: true,
              updated_at: true,
              app_user: {
                select: {
                  email: true,
                  email_verified_at: true,
                  created_at: true,
                  last_sign_in_at: true,
                  disabled_at: true,
                },
              },
            },
          })
        : null;
    const students = subject.studentIds.length
      ? await prisma.student.findMany({
          where: { id: { in: subject.studentIds } },
          select: {
            id: true,
            school_id: true,
            first_name: true,
            last_name: true,
            date_of_birth: true,
            gender: true,
            enrollment_date: true,
            is_active: true,
            student_number: true,
            form_tutor_id: true,
            user_profile_id: true,
          },
        })
      : [];
    const restrictions = subject.studentIds.length
      ? await prisma.student_restriction.findMany({
            where: { student_id: { in: subject.studentIds } },
            select: {
              student_id: true,
              no_ai: true,
              no_similarity: true,
              exclude_from_analytics: true,
              set_at: true,
            },
          })
      : [];
    const schools = await schoolNames(ctx, [account?.school_id ?? null, ...students.map((s) => s.school_id)]);
    const tutors = subject.scope === 'parent' ? new Map() : await personNames(ctx, students.map((s) => s.form_tutor_id));

    const restrictionByStudent = new Map(restrictions.map((r) => [r.student_id, r]));
    const studentRecords = students.map((s) =>
      subject.scope === 'parent'
        ? {
            firstName: s.first_name,
            lastName: s.last_name,
            dateOfBirth: day(s.date_of_birth as Date),
            school: schools.get((s.school_id ?? '')) ?? null,
          }
        : {
            id: s.id,
            firstName: s.first_name,
            lastName: s.last_name,
            dateOfBirth: day(s.date_of_birth as Date),
            gender: s.gender,
            school: schools.get((s.school_id ?? '')) ?? null,
            studentNumber: s.student_number,
            enrollmentDate: day(s.enrollment_date as Date),
            active: s.is_active,
            formTutor: s.form_tutor_id ? (tutors.get(s.form_tutor_id) ?? null) : null,
            hasAccount: !!s.user_profile_id,
            processingRestrictions: (() => {
              const r = restrictionByStudent.get(s.id);
              return r
                ? {
                    noAi: r.no_ai,
                    noSimilarity: r.no_similarity,
                    excludeFromAnalytics: r.exclude_from_analytics,
                    lastChangedAt: r.set_at,
                  }
                : null;
            })(),
          },
    );
    const data = {
      account: account
        ? {
            id: account.id,
            email: account.app_user?.email ?? account.email,
            emailVerifiedAt: account.app_user?.email_verified_at ?? null,
            name: fullName(account),
            firstName: account.first_name,
            lastName: account.last_name,
            accountType: account.account_type,
            role: account.role,
            avatarUrl: account.avatar_url,
            active: account.is_active,
            disabledAt: account.app_user?.disabled_at ?? null,
            activeSchool: account.school_id ? (schools.get(account.school_id) ?? null) : null,
            createdAt: account.app_user?.created_at ?? account.created_at,
            updatedAt: account.updated_at,
            lastSignInAt: account.app_user?.last_sign_in_at ?? null,
          }
        : null,
      studentRecords,
    };
    return { data, count: (account ? 1 : 0) + studentRecords.length };
  },
};

export const identitiesCollector: Collector = {
  id: 'sign-in-identities',
  title: 'Sign-in identities',
  description:
    'The single sign-on accounts (Google, Microsoft, SAML, OpenID Connect) linked to the account: provider, the identifier and email it sent, and the claims it sent at the last sign-in.',
  covers: ['account.identity.user_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    if (!hasAccount(ctx)) return { data: [], count: 0 };
    const rows = await ctx.prisma.identity.findMany({
      where: { user_id: ctx.subject.userId! },
      select: { provider: true, subject: true, email: true, claims: true, created_at: true, last_used_at: true },
      orderBy: { created_at: 'asc' },
    });
    const data = rows.map((r) => ({
      provider: r.provider,
      subject: r.subject,
      email: r.email,
      claims: r.claims,
      linkedAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
    return { data, count: data.length };
  },
};

export const sessionsCollector: Collector = {
  id: 'sessions',
  title: 'Sign-in sessions',
  description:
    'Each sign-in session still on record: when it started, was last used and ends, how the person signed in, the browser or app and IP address it came from, and whether and why it was signed out. Session tokens are never included.',
  covers: ['account.session.user_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    if (!hasAccount(ctx)) return { data: [], count: 0 };
    const rows = await ctx.prisma.session.findMany({
      where: { user_id: ctx.subject.userId! },
      select: {
        created_at: true,
        last_seen_at: true,
        expires_at: true,
        absolute_expires_at: true,
        revoked_at: true,
        revoked_reason: true,
        method: true,
        user_agent: true,
        ip: true,
        device: true,
      },
      orderBy: { created_at: 'desc' },
    });
    const data = rows.map((r) => ({
      startedAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      absoluteExpiresAt: r.absolute_expires_at,
      signedOutAt: r.revoked_at,
      signedOutReason: r.revoked_reason,
      method: r.method,
      device: r.device,
      userAgent: r.user_agent,
      ipAddress: r.ip,
    }));
    return { data, count: data.length };
  },
};

export const devicesCollector: Collector = {
  id: 'devices',
  title: 'Devices',
  description:
    'Devices the account has signed in from (a one-way fingerprint used for new sign-in alerts, first and last seen) and phones registered for push notifications (platform, registered, last seen; the push token itself is a sending credential and is left out).',
  covers: ['account.known_device.user_id', 'public.push_device.user_id'],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    if (!hasAccount(ctx)) return { data: { knownDevices: [], pushDevices: [] }, count: 0 };
    const [known, push] = await Promise.all([
      ctx.prisma.known_device.findMany({
        where: { user_id: ctx.subject.userId! },
        select: { fingerprint: true, first_seen_at: true, last_seen_at: true },
        orderBy: { first_seen_at: 'asc' },
      }),
      ctx.prisma.push_device.findMany({
        where: { user_id: ctx.subject.userId! },
        select: { platform: true, created_at: true, last_seen_at: true },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    const data = {
      knownDevices: known.map((k) => ({ fingerprint: k.fingerprint, firstSeenAt: k.first_seen_at, lastSeenAt: k.last_seen_at })),
      pushDevices: push.map((p) => ({ platform: p.platform, registeredAt: p.created_at, lastSeenAt: p.last_seen_at })),
    };
    return { data, count: known.length + push.length };
  },
};

/** Safe account-security metadata; authentication secrets and hashes never leave the server. */
export const securityCollector: Collector = {
  id: 'account-security',
  title: 'Account security',
  description: 'Pending email-change details and authenticator setup status. Verification codes, authenticator secrets and recovery-code hashes are never included.',
  covers: [
    'account.email_change.user_id',
    'account.mfa_totp.user_id',
    'account.mfa_recovery_code.user_id',
    'account.mfa_enrolment_gate.user_id',
  ],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    if (!hasAccount(ctx)) return { data: null, count: 0 };
    const userId = ctx.subject.userId!;
    const [emailChange, totp, recoveryCodes, gates] = await Promise.all([
      ctx.prisma.email_change.findUnique({
        where: { user_id: userId },
        select: { new_email: true, expires_at: true, attempts: true, sends: true, created_at: true },
      }),
      ctx.prisma.mfa_totp.findUnique({
        where: { user_id: userId },
        select: { enabled_at: true, pending_created_at: true, created_at: true, updated_at: true },
      }),
      ctx.prisma.mfa_recovery_code.findMany({
        where: { user_id: userId },
        select: { used_at: true, created_at: true },
        orderBy: { created_at: 'asc' },
      }),
      ctx.prisma.mfa_enrolment_gate.findMany({
        where: { user_id: userId },
        select: { created_at: true },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    const data = {
      pendingEmailChange: emailChange
        ? { newEmail: emailChange.new_email, expiresAt: emailChange.expires_at, attempts: emailChange.attempts, sends: emailChange.sends, createdAt: emailChange.created_at }
        : null,
      authenticator: totp
        ? { enabledAt: totp.enabled_at, setupStartedAt: totp.pending_created_at, createdAt: totp.created_at, updatedAt: totp.updated_at }
        : null,
      recoveryCodes: recoveryCodes.map((code) => ({ createdAt: code.created_at, usedAt: code.used_at })),
      authenticatorEnrolmentRequiredSince: gates.map((gate) => gate.created_at),
    };
    return { data, count: (emailChange ? 1 : 0) + (totp ? 1 : 0) + recoveryCodes.length + gates.length };
  },
};
