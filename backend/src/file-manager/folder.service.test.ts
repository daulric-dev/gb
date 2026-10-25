import { describe, test, expect } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { FolderService } from './folder.service';
import { expectRejection } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const USER = 'u1';
// Folder ids come from URLs and must be uuids to be looked up at all.
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const P = '00000000-0000-4000-8000-00000000000c';
const F1 = '00000000-0000-4000-8000-0000000000f1';

function folderRow(over: Record<string, any> = {}) {
  return {
    id: F1,
    school_id: 's1',
    owner_id: USER,
    parent_id: null,
    name: 'Folder',
    is_system: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate key', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function service(setup: (prisma: MockPrisma) => void = () => {}) {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 's1' });
  setup(prisma);
  return { svc: new FolderService(prisma as any, createMockErasureLog() as any), prisma };
}

describe('FolderService.create', () => {
  test('creates a root folder and sanitizes the name', async () => {
    const { svc, prisma } = service((p) =>
      p.folder.create.mockImplementation(async ({ data }) =>
        folderRow({ name: data.name, parent_id: null }),
      ),
    );
    const out = await svc.create(USER, '  Term / Reports  ');
    // Slashes are replaced (they would break folder pathing) and trimmed.
    expect(out.name).toBe('Term - Reports');
    expect(out.parentId).toBeNull();
    expect(out.isSystem).toBe(false);
    expect(prisma.folder.create.mock.calls[0][0].data).toMatchObject({
      school_id: 's1',
      owner_id: USER,
      parent_id: null,
    });
  });

  test('rejects a duplicate name via the unique index', async () => {
    const { svc } = service((p) =>
      p.folder.create.mockRejectedValue(uniqueViolation()),
    );
    const err = (await expectRejection(svc.create(USER, 'Reports'))) as Error;
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('A folder with that name already exists here');
  });

  test('rejects an empty name', async () => {
    const { svc } = service();
    const err = await expectRejection(svc.create(USER, '   '));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('FolderService.rename', () => {
  test('refuses to rename a system folder', async () => {
    // getOwned resolves via findFirst; return a system folder.
    const { svc } = service((p) =>
      p.folder.findFirst.mockResolvedValue(
        folderRow({ is_system: true, name: 'Reports' }),
      ),
    );
    const err = await expectRejection(svc.rename(USER, F1, 'Nope'));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('FolderService.move', () => {
  test('rejects moving a folder into itself', async () => {
    const { svc } = service((p) =>
      p.folder.findFirst.mockResolvedValue(folderRow({ id: A })),
    );
    const err = await expectRejection(svc.move(USER, A, A));
    expect(err).toBeInstanceOf(BadRequestException);
  });

  test('is a no-op when the folder is already in the destination', async () => {
    const { svc } = service((p) => {
      p.folder.findFirst.mockResolvedValue(
        folderRow({ id: A, parent_id: P }),
      );
      p.folder.update.mockImplementation(() => {
        throw new Error('should not update on a no-op move');
      });
    });
    const out = await svc.move(USER, A, P);
    expect(out.parentId).toBe(P);
  });

  test('moves a folder to the root', async () => {
    const { svc } = service((p) => {
      p.folder.findFirst.mockResolvedValue(
        folderRow({ id: A, parent_id: P }),
      );
      p.folder.update.mockResolvedValue(
        folderRow({ id: A, parent_id: null }),
      );
    });
    const out = await svc.move(USER, A, null);
    expect(out.parentId).toBeNull();
  });

  test('rejects moving a folder into one of its own descendants', async () => {
    let subtreeCalls = 0;
    const { svc } = service((p) => {
      p.folder.update.mockResolvedValue(folderRow());
      // getOwned queries filter by id.
      p.folder.findFirst.mockImplementation(async ({ where }) => {
        if (where.id === A) return folderRow({ id: A, parent_id: null });
        if (where.id === B) return folderRow({ id: B, parent_id: A });
        return null;
      });
      // collectSubtree BFS: first level returns B, then nothing.
      p.folder.findMany.mockImplementation(async () => {
        subtreeCalls += 1;
        return subtreeCalls === 1 ? [{ id: B }] : [];
      });
    });
    // B is a child of A; moving A under B would create a cycle.
    const err = await expectRejection(svc.move(USER, A, B));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
