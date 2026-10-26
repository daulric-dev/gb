import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FileShareService } from './file-share.service';
import { SharePrincipalType } from './dto/share-file.dto';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const FILE = 'f1';
const SCHOOL = 'school-1';
const OWNER = 'owner-1';

describe('FileShareService.share', () => {
  let prisma: MockPrisma;
  let queue: { enqueueShareNotify: ReturnType<typeof mock> };
  let service: FileShareService;

  beforeEach(() => {
    prisma = createMockPrisma();
    queue = { enqueueShareNotify: mock(async () => undefined) };
    prisma.file_share.upsert.mockImplementation(async ({ create }) => ({
      id: `share-${create.principal_id}`,
      principal_type: create.principal_type,
      principal_id: create.principal_id,
      can_download: create.can_download,
      created_at: null,
    }));
    service = new FileShareService(prisma as any, queue as any);
  });

  test('shares with a member of the school', async () => {
    prisma.user_profile.findMany.mockResolvedValue([{ id: 'u2' }]);
    const rows = await service.share(FILE, SCHOOL, OWNER, [
      { principalType: SharePrincipalType.User, principalId: 'u2' },
    ]);
    expect(rows).toHaveLength(1);
    const where = prisma.user_profile.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['u2'] });
    expect(where.OR).toEqual([
      { school_id: SCHOOL },
      { school_management: { some: { school_id: SCHOOL } } },
    ]);
  });

  test('a user from another school is a 400 and nothing is written', async () => {
    prisma.user_profile.findMany.mockResolvedValue([]);
    const err = await expectRejection(
      service.share(FILE, SCHOOL, OWNER, [
        { principalType: SharePrincipalType.User, principalId: 'stranger' },
      ]),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.file_share.upsert).not.toHaveBeenCalled();
    expect(queue.enqueueShareNotify).not.toHaveBeenCalled();
  });

  test('a role from another school is a 400', async () => {
    prisma.school_role.findMany.mockResolvedValue([]);
    const err = await expectRejection(
      service.share(FILE, SCHOOL, OWNER, [
        { principalType: SharePrincipalType.Role, principalId: 'role-x' },
      ]),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(prisma.school_role.findMany.mock.calls[0][0].where).toEqual({
      school_id: SCHOOL,
      id: { in: ['role-x'] },
    });
    expect(prisma.file_share.upsert).not.toHaveBeenCalled();
  });

  test('a role of the school is accepted', async () => {
    prisma.school_role.findMany.mockResolvedValue([{ id: 'role-1' }]);
    const rows = await service.share(FILE, SCHOOL, OWNER, [
      { principalType: SharePrincipalType.Role, principalId: 'role-1' },
    ]);
    expect(rows).toHaveLength(1);
  });

  test('a course of another school is still a 404', async () => {
    const err = await expectRejection(
      service.share(FILE, SCHOOL, OWNER, [
        { principalType: SharePrincipalType.Course, principalId: 'c-x' },
      ]),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('duplicate targets are checked once', async () => {
    prisma.user_profile.findMany.mockResolvedValue([{ id: 'u2' }]);
    await service.share(FILE, SCHOOL, OWNER, [
      { principalType: SharePrincipalType.User, principalId: 'u2' },
      { principalType: SharePrincipalType.User, principalId: 'u2' },
    ]);
    expect(prisma.user_profile.findMany.mock.calls[0][0].where.id).toEqual({
      in: ['u2'],
    });
  });
});
