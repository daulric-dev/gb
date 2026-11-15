import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OrganisationUsersService } from './organisation-users.service';
import { OrganisationUsersController } from './organisation-users.controller';
import { OrganisationAdminGuard } from './organisation-admin.guard';

describe('OrganisationUsersService.list', () => {
  test('searches name and email, pages, and shapes each account', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findMany.mockResolvedValue([
      {
        id: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: null,
        account_type: 'staff',
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00Z'),
        school_id: 's2',
        school_management: [{ school: { id: 's1', name: 'Hill' } }],
        app_user: { email: 'ada@example.org', last_sign_in_at: new Date('2026-11-01T00:00:00Z'), mfa_totp: { enabled_at: new Date() } },
      },
    ]);
    prisma.user_profile.count.mockResolvedValue(41);
    prisma.school.findMany.mockResolvedValue([{ id: 's2', name: 'Abbey' }]);
    const out = await new OrganisationUsersService(prisma as any).list({ search: 'ada love', page: 2, limit: 20, accountType: 'staff' });

    const args = prisma.user_profile.findMany.mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(20);
    expect(args.where.AND).toHaveLength(3);
    expect(args.where.AND[0]).toEqual({ account_type: 'staff' });
    expect(JSON.stringify(args.where.AND[1])).toContain('"contains":"ada"');
    expect(out).toEqual({
      users: [
        {
          id: 'u1',
          name: 'Ada Lovelace',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.org',
          accountType: 'staff',
          isActive: true,
          schools: [{ id: 's2', name: 'Abbey' }, { id: 's1', name: 'Hill' }],
          mfaEnrolled: true,
          lastSignInAt: '2026-11-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 41,
      page: 2,
      limit: 20,
    });
  });

  test('the route is for organisation admins only', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OrganisationUsersController) as unknown[];
    expect(guards).toContain(OrganisationAdminGuard);
  });
});
