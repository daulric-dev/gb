import { describe, test, expect, beforeEach } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SchoolService } from './school.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const SCHOOL_TTL = 60 * 60 * 24 * 30;

describe('SchoolService', () => {
  let service: SchoolService;
  let prisma: MockPrisma;
  let mockCache: ReturnType<typeof createMockCacheService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    mockCache = createMockCacheService();
    service = new SchoolService(prisma as any, mockCache as any);
  });

  describe('findAll', () => {
    const schools = [
      { id: '1', name: 'Alpha School', school_type: 'primary' },
      { id: '2', name: 'Beta School', school_type: 'secondary' },
    ];

    test('returns cached data when available', async () => {
      await mockCache.set('schools:all', schools, SCHOOL_TTL);

      const result = await service.findAll();
      expect(result).toEqual(schools);
      expect(prisma.school.findMany).not.toHaveBeenCalled();
    });

    test('fetches from DB and caches when not cached', async () => {
      prisma.school.findMany.mockResolvedValue(schools);

      const result = await service.findAll();
      expect(result).toEqual(schools);
      expect(prisma.school.findMany.mock.calls[0][0].where).toEqual({
        is_active: true,
      });

      const cached = await mockCache.get('schools:all');
      expect(cached).toEqual(schools);
    });
  });

  describe('create', () => {
    const newSchool = { id: '3', name: 'Gamma School', school_type: 'primary' };

    test('calls cache.update to append new school to list', async () => {
      const existing = [{ id: '1', name: 'Alpha School' }];
      await mockCache.set('schools:all', existing, SCHOOL_TTL);
      prisma.school.create.mockResolvedValue(newSchool);

      await service.create(
        { name: 'Gamma School', schoolType: 'primary' } as any,
        'user-1',
      );

      const cached = await mockCache.get('schools:all');
      expect(cached).toBeArray();
      expect(cached).toHaveLength(2);
      expect(cached.some((s: any) => s.id === '3')).toBe(true);

      // Creator becomes the admin member, mirrored on the profile.
      expect(prisma.school_management.create.mock.calls[0][0].data).toEqual({
        user_id: 'user-1',
        school_id: '3',
        role: 'admin',
      });
      expect(prisma.user_profile.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'user-1' },
        data: { school_id: '3', role: 'admin' },
      });
    });

    test('throws on DB error', () => {
      prisma.school.create.mockRejectedValue(new Error('duplicate key'));

      expect(
        service.create(
          { name: 'Fail School', schoolType: 'primary' } as any,
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createJoinRequest', () => {
    const userId = 'user-join';
    const school = { id: 's1', name: 'Orphan School' };

    function makeService(opts: {
      school?: any;
      existingRequest?: any;
      insertError?: Error;
    }) {
      const db = createMockPrisma();
      db.school.findFirst.mockResolvedValue(
        'school' in opts ? opts.school : school,
      );
      db.school_join_request.findFirst.mockResolvedValue(
        opts.existingRequest ?? null,
      );
      if (opts.insertError) {
        db.school_join_request.create.mockRejectedValue(opts.insertError);
      } else {
        db.school_join_request.create.mockResolvedValue({
          id: 'req-1',
          user_id: userId,
          school_id: 's1',
          status: 'pending',
        });
      }
      return {
        service: new SchoolService(
          db as any,
          createMockCacheService() as any,
        ),
        db,
      };
    }

    test('creates a join request for a school that has no admin (no auto-takeover)', async () => {
      const { service: svc, db } = makeService({});
      const result: any = await svc.createJoinRequest(
        userId,
        's1',
        'let me in',
      );

      expect(result.id).toBe('req-1');
      expect(result.school).toEqual(school);
      // The core regression: joining must never grant admin.
      for (const fn of Object.values(db.school_management)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    test('never writes a role anywhere while joining', async () => {
      const { service: svc, db } = makeService({});
      await svc.createJoinRequest(userId, 's1');

      const data = db.school_join_request.create.mock.calls[0][0].data;
      expect('role' in data).toBe(false);
      expect(db.user_profile.update).not.toHaveBeenCalled();
      expect(db.user_profile.updateMany).not.toHaveBeenCalled();
    });

    test('throws NotFound when the school does not exist', async () => {
      const { service: svc } = makeService({ school: null });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 'missing')),
      ).toBeInstanceOf(NotFoundException);
    });

    test('rejects a duplicate pending request', async () => {
      const { service: svc } = makeService({
        existingRequest: { id: 'req-old', school_id: 's1' },
      });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 's1')),
      ).toBeInstanceOf(BadRequestException);
    });

    test('surfaces an insert failure', async () => {
      const { service: svc } = makeService({
        insertError: new Error('db down'),
      });
      expect(
        await expectRejection(svc.createJoinRequest(userId, 's1')),
      ).toBeInstanceOf(BadRequestException);
    });
  });

  describe('getMembers', () => {
    test('keeps the user/school aliases and surfaces custom roles only', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's1' });
      prisma.school_management.findMany.mockResolvedValue([
        {
          id: 'm1',
          role: 'admin',
          created_at: new Date('2026-01-01T00:00:00Z'),
          school: { owner_id: 'u1' },
          user_profile: { id: 'u1', first_name: 'A', last_name: 'B', avatar_url: null },
          school_management_role: [
            { school_role: { id: 'r1', name: 'Librarian', is_system: false } },
            { school_role: { id: 'r2', name: 'teacher', is_system: true } },
          ],
        },
      ]);

      const [member] = await service.getMembers('u1');
      expect(member.user).toEqual({
        id: 'u1',
        first_name: 'A',
        last_name: 'B',
        avatar_url: null,
      });
      expect(member.school).toEqual({ owner_id: 'u1' });
      expect(member.is_owner).toBe(true);
      expect(member.roles).toEqual([{ id: 'r1', name: 'Librarian' }]);
      expect('school_management_role' in member).toBe(false);
    });
  });

  describe('approveRequest', () => {
    test('rejects a request from another school', async () => {
      prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's1' });
      prisma.school_join_request.findUnique.mockResolvedValue({
        id: 'req',
        user_id: 'u2',
        school_id: 's2',
        status: 'pending',
      });
      expect(
        await expectRejection(service.approveRequest('admin', 'req', 'teacher')),
      ).toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('upserts membership, mirrors profile and marks approved', async () => {
      prisma.user_profile.findUnique.mockImplementation(async ({ where }) =>
        where.id === 'admin'
          ? { school_id: 's1' }
          : { account_type: 'staff' },
      );
      prisma.school_join_request.findUnique.mockResolvedValue({
        id: 'req',
        user_id: 'u2',
        school_id: 's1',
        status: 'pending',
      });
      prisma.school_management.upsert.mockResolvedValue({ id: 'm9' });
      prisma.school_join_request.update.mockResolvedValue({
        id: 'req',
        status: 'approved',
      });

      const result = await service.approveRequest('admin', 'req', 'teacher');
      expect(result).toEqual({ id: 'req', status: 'approved' } as any);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user_profile.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'u2' },
        data: { school_id: 's1', role: 'teacher', is_active: true },
      });
    });
  });
});
