import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SchoolLogoService } from './school-logo.service';
import { SchoolController } from './school.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { ImagesService } from '@/images/images.service';
import { PermissionGuard } from '@/permission/permission.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const SCHOOL = '33333333-3333-4333-8333-333333333333';
const OLD = `school-logos/${SCHOOL}-${'b'.repeat(32)}.png`;
const STAGED = `uploads/school-logos/${SCHOOL}-${'a'.repeat(32)}.png`;

function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16, 1),
  ]);
}

function setup(
  opts: { logoPath?: string | null; stored?: { bytes: Buffer; type: string } } = {},
) {
  const stored = opts.stored ?? { bytes: pngBytes(), type: 'image/png' };
  const prisma: MockPrisma = createMockPrisma();
  prisma.school.findUnique.mockResolvedValue({ logo_path: opts.logoPath ?? null });
  prisma.school.update.mockResolvedValue({ id: SCHOOL });
  prisma.user_profile.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
  const storage = {
    put: mock((..._args: any[]) => Promise.resolve()),
    delete: mock((..._args: any[]) => Promise.resolve()),
    exists: mock((..._args: any[]) =>
      Promise.resolve({ size: stored.bytes.byteLength, contentType: stored.type }),
    ),
    getBuffer: mock((..._args: any[]) => Promise.resolve(stored.bytes)),
    uploadUrl: mock((key: string, ..._rest: any[]) =>
      Promise.resolve(`https://s3.test/${key}?sig`),
    ),
  };
  const cache = createMockCacheService() as any;
  cache.delete = mock(async (..._args: any[]) => {});
  const images = new ImagesService(storage as any, prisma as any, cache);
  return {
    prisma,
    storage,
    cache,
    svc: new SchoolLogoService(images, prisma as any, cache),
  };
}

describe('SchoolController logo routes', () => {
  const proto = SchoolController.prototype as any;

  test('sit behind AuthGuard and PermissionGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolController)).toEqual([
      AuthGuard,
      PermissionGuard,
    ]);
  });

  // A member or teacher without school:update is refused by PermissionGuard.
  for (const method of ['logoTicket', 'logoComplete', 'logoRemove']) {
    test(`${method} requires school:update`, () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, proto[method])).toBe(
        'school:update',
      );
    });
  }
});

describe('SchoolLogoService', () => {
  test('a ticket stages a random key under uploads/school-logos', async () => {
    const { svc, storage } = setup();
    const ticket = await svc.createTicket(SCHOOL, 'image/jpeg', 2048);
    expect(ticket.path).toMatch(
      new RegExp(`^uploads/school-logos/${SCHOOL}-[0-9a-f]{32}\\.jpg$`),
    );
    expect(storage.uploadUrl.mock.calls[0][0]).toBe(`images/${ticket.path}`);
  });

  test('a ticket refuses SVG, non-images and anything over 2 MB', async () => {
    const { svc } = setup();
    for (const type of ['image/svg+xml', 'application/pdf']) {
      expect(await expectRejection(svc.createTicket(SCHOOL, type, 10))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(
      await expectRejection(
        svc.createTicket(SCHOOL, 'image/png', 2 * 1024 * 1024 + 1),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('complete serves the logo, replaces the old one and refreshes profiles', async () => {
    const { svc, storage, prisma, cache } = setup({ logoPath: OLD });
    const res = await svc.complete(SCHOOL, STAGED);

    const served = STAGED.slice('uploads/'.length);
    expect(res.logoUrl).toEndWith(`/images/${served}`);
    expect(storage.put.mock.calls[0][0]).toBe(`images/${served}`);
    expect(prisma.school.update.mock.calls[0][0].data.logo_path).toBe(served);
    const deleted = storage.delete.mock.calls.map((c: any[]) => c[0]);
    expect(deleted).toContain(`images/${STAGED}`);
    expect(deleted).toContain(`images/${OLD}`);
    expect(cache.delete).toHaveBeenCalledWith('profile:u1');
    expect(cache.delete).toHaveBeenCalledWith('profile:u2');
  });

  test("complete refuses another school's staging key", async () => {
    const { svc, storage } = setup();
    const other = `uploads/school-logos/44444444-4444-4444-8444-444444444444-${'a'.repeat(32)}.png`;
    expect(await expectRejection(svc.complete(SCHOOL, other))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  test('complete rejects bytes that are not the declared image', async () => {
    const { svc, storage, prisma } = setup({
      stored: { bytes: Buffer.from('<svg onload="x()"></svg>....'), type: 'image/png' },
    });
    expect(await expectRejection(svc.complete(SCHOOL, STAGED))).toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.school.update).not.toHaveBeenCalled();
  });

  test('remove clears the key and deletes the object', async () => {
    const { svc, storage, prisma } = setup({ logoPath: OLD });
    expect(await svc.remove(SCHOOL)).toEqual({ logoUrl: null });
    expect(prisma.school.update.mock.calls[0][0].data.logo_path).toBeNull();
    expect(storage.delete.mock.calls[0][0]).toBe(`images/${OLD}`);
  });
});
