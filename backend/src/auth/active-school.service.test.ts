import { beforeEach, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ActiveSchoolService } from './active-school.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { permCacheKey } from '@/permission/permission.effective';

const school = (id: string, name: string, is_active: boolean | null = true) => ({
  id,
  name,
  logo_path: null,
  is_active,
});

describe('ActiveSchoolService', () => {
  let prisma: MockPrisma;
  let cache: ReturnType<typeof createMockCacheService>;
  let service: ActiveSchoolService;
  const auth = { getProfile: async (id: string) => ({ id, refreshed: true }) };

  const orgAdmin = () =>
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u1' });

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheService();
    service = new ActiveSchoolService(prisma as any, cache as any, auth as any);
  });

  describe('list', () => {
    test('a single member sees their school, marked active', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'a', account_type: 'staff' });
      prisma.school_management.findMany.mockResolvedValue([
        { role: 'teacher', school: school('a', 'Alpha') },
      ]);
      expect(await service.list('u1')).toEqual([
        { id: 'a', name: 'Alpha', logoUrl: null, role: 'teacher', viaOrganisation: false, isActive: true },
      ]);
      expect(prisma.school.findMany).not.toHaveBeenCalled();
    });

    test('a member of several schools sees each, sorted, inactive ones left out', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'b', account_type: 'staff' });
      prisma.school_management.findMany.mockResolvedValue([
        { role: 'teacher', school: school('b', 'Beta') },
        { role: 'admin', school: school('a', 'Alpha') },
        { role: 'teacher', school: school('c', 'Closed', false) },
      ]);
      const rows = await service.list('u1');
      expect(rows.map((r) => [r.id, r.role, r.isActive])).toEqual([
        ['a', 'admin', false],
        ['b', 'teacher', true],
      ]);
    });

    test('an organisation admin also sees every active school, via organisation', async () => {
      orgAdmin();
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'a', account_type: 'staff' });
      prisma.school_management.findMany.mockResolvedValue([
        { role: 'teacher', school: school('a', 'Alpha') },
      ]);
      prisma.school.findMany.mockResolvedValue([school('a', 'Alpha'), school('b', 'Beta', null)]);
      const rows = await service.list('u1');
      expect(rows.map((r) => [r.id, r.role, r.viaOrganisation])).toEqual([
        ['a', 'teacher', false],
        ['b', null, true],
      ]);
      expect(prisma.school.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ is_active: true }, { is_active: null }],
      });
    });

    test('a student sees only their own school', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'a', account_type: 'student' });
      prisma.school.findUnique.mockResolvedValue(school('a', 'Alpha'));
      expect(await service.list('u1')).toEqual([
        { id: 'a', name: 'Alpha', logoUrl: null, role: null, viaOrganisation: false, isActive: true },
      ]);
      expect(prisma.school_management.findMany).not.toHaveBeenCalled();
    });
  });

  describe('switch', () => {
    beforeEach(() => {
      prisma.user_profile.findUnique.mockResolvedValue({ account_type: 'staff' });
      prisma.school.findUnique.mockResolvedValue({ id: 'b', is_active: true });
    });

    test('a member switches and their membership role is mirrored', async () => {
      prisma.school_management.findUnique.mockResolvedValue({ role: 'teacher' });
      await cache.set('profile:u1', { stale: true }, 60);
      await cache.set(permCacheKey('u1', 'a'), { member: true }, 60);
      await cache.set(permCacheKey('u2', 'a'), { member: true }, 60);

      expect(await service.switch('u1', 'b')).toEqual({ id: 'u1', refreshed: true } as any);
      const update = prisma.user_profile.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u1' });
      expect(update.data).toMatchObject({ school_id: 'b', role: 'teacher' });
      expect(await cache.get('profile:u1')).toBeNull();
      expect(await cache.get(permCacheKey('u1', 'a'))).toBeNull();
      expect(await cache.get(permCacheKey('u2', 'a'))).not.toBeNull();
    });

    test('an organisation admin switches to any active school as admin', async () => {
      orgAdmin();
      await service.switch('u1', 'b');
      expect(prisma.user_profile.update.mock.calls[0][0].data).toMatchObject({
        school_id: 'b',
        role: 'admin',
      });
    });

    test('a stranger is refused', async () => {
      const err = await expectRejection(service.switch('u1', 'b'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.user_profile.update).not.toHaveBeenCalled();
    });

    test('an inactive school is a 400', async () => {
      orgAdmin();
      prisma.school.findUnique.mockResolvedValue({ id: 'b', is_active: false });
      const err = await expectRejection(service.switch('u1', 'b'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.user_profile.update).not.toHaveBeenCalled();
    });

    test('students cannot switch', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ account_type: 'student' });
      prisma.school_management.findUnique.mockResolvedValue({ role: 'teacher' });
      const err = await expectRejection(service.switch('u1', 'b'));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(prisma.user_profile.update).not.toHaveBeenCalled();
    });
  });
});
