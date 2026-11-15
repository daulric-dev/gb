import { Injectable } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { textSearch } from '@/common/text-search';

export type AccountType = 'staff' | 'student' | 'parent';

export interface OrganisationUserRow {
  id: string;
  /** "First Last", or null when the profile has no name. */
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  /** The sign-in email (account.app_user), else the profile's. */
  email: string | null;
  accountType: AccountType;
  isActive: boolean;
  /** Every school the account is a member of, plus its active school. */
  schools: { id: string; name: string }[];
  /** An authenticator app is set up (src/mfa). */
  mfaEnrolled: boolean;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export interface OrganisationUserPage {
  users: OrganisationUserRow[];
  total: number;
  page: number;
  limit: number;
}

export interface OrganisationUserQuery {
  search?: string;
  accountType?: AccountType;
  page?: number;
  limit?: number;
}

/**
 * Every user account of the install, for the organisation console (find an
 * account to reset two-step verification for or delete). Organisation
 * admins only (the controller's guard).
 */
@Injectable()
export class OrganisationUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: OrganisationUserQuery = {}): Promise<OrganisationUserPage> {
    const limit = Math.min(100, Math.max(1, Math.floor(q.limit ?? 25) || 25));
    const page = Math.max(1, Math.floor(q.page ?? 1) || 1);
    const and: Prisma.user_profileWhereInput[] = [];
    if (q.accountType) and.push({ account_type: q.accountType });
    const terms = (q.search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      const text = term.slice(0, 100);
      and.push({
        OR: [
          { first_name: textSearch.contains(text) },
          { last_name: textSearch.contains(text) },
          { email: textSearch.contains(text) },
          { app_user: { email: textSearch.contains(text) } },
        ],
      });
    }
    const where: Prisma.user_profileWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      this.prisma.user_profile.findMany({
        where,
        orderBy: [{ last_name: 'asc' }, { first_name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
          account_type: true,
          is_active: true,
          created_at: true,
          school_id: true,
          school_management: { select: { school: { select: { id: true, name: true } } } },
          app_user: {
            select: {
              email: true,
              last_sign_in_at: true,
              mfa_totp: { select: { enabled_at: true } },
            },
          },
        },
      }),
      this.prisma.user_profile.count({ where }),
    ]);

    // The active school, when it is not (or no longer) a membership: a
    // student's school, for instance.
    const activeIds = [
      ...new Set(
        rows
          .filter((r) => r.school_id && !r.school_management.some((m) => m.school?.id === r.school_id))
          .map((r) => r.school_id as string),
      ),
    ];
    const active = activeIds.length
      ? await this.prisma.school.findMany({ where: { id: { in: activeIds } }, select: { id: true, name: true } })
      : [];
    const activeName = new Map(active.map((s) => [s.id, s.name ?? ""]));

    return {
      users: rows.map((r) => {
        const schools = new Map<string, string>();
        for (const m of r.school_management) if (m.school) schools.set(m.school.id, m.school.name ?? "");
        if (r.school_id && !schools.has(r.school_id) && activeName.has(r.school_id)) {
          schools.set(r.school_id, activeName.get(r.school_id)!);
        }
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null;
        return {
          id: r.id,
          name,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.app_user?.email ?? r.email ?? null,
          accountType: r.account_type,
          isActive: r.is_active !== false,
          schools: [...schools].map(([id, n]) => ({ id, name: n })).sort((a, b) => a.name.localeCompare(b.name)),
          mfaEnrolled: !!r.app_user?.mfa_totp?.enabled_at,
          lastSignInAt: r.app_user?.last_sign_in_at?.toISOString() ?? null,
          createdAt: r.created_at?.toISOString() ?? null,
        };
      }),
      total,
      page,
      limit,
    };
  }
}
