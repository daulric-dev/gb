import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { DataExportService } from './data-export.service';

const USER = '11111111-1111-4111-8111-111111111111';
const EXPORT = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';

function row(over: Record<string, unknown> = {}) {
  return {
    id: EXPORT,
    requested_by: USER,
    kind: 'self',
    status: 'ready',
    subject_user_id: USER,
    student_id: null,
    school_id: null,
    storage_key: 'data-exports/x.zip',
    expires_at: new Date(Date.now() + 3_600_000),
    completed_at: new Date(),
    created_at: new Date(),
    downloaded_at: null,
    byte_size: 10n,
    manifest: {},
    error: null,
    ...over,
  };
}

function setup() {
  const prisma = createMockPrisma();
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  const storage = { downloadUrl: mock(async () => 'https://signed.example/x'), delete: mock(async () => undefined) };
  const audit = { record: mock(async () => undefined) };
  const features = { isEnabled: async () => true };
  const svc = new DataExportService(
    prisma as any,
    createMockCacheService() as any,
    storage as any,
    features as any,
    audit as any,
    {} as any,
    {} as any,
  );
  return { prisma, storage, audit, svc };
}

describe('DataExportService', () => {
  test('list filters by kind and pages; each view carries ttlHours and expiresAt', async () => {
    const { prisma, svc } = setup();
    prisma.data_export.findMany.mockResolvedValue([row()]);
    const out = await svc.list(USER, { kind: 'self', page: 3, limit: 10 });
    const args = prisma.data_export.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ requested_by: USER, kind: 'self' });
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(out[0].ttlHours).toBe(24);
    expect(out[0].expiresAt).toBeString();
    // Out-of-range limits are clamped.
    await svc.list(USER, { limit: 1000 });
    expect(prisma.data_export.findMany.mock.calls[1][0].take).toBe(100);
  });

  test('download checks access again and refuses when it is gone', async () => {
    const { prisma, storage, svc } = setup();
    prisma.data_export.findFirst.mockResolvedValue(row({ kind: 'student', student_id: STUDENT, subject_user_id: null }));
    prisma.student.findUnique.mockResolvedValue(null); // the student (or access to them) is gone
    const err = await expectRejection(svc.download(USER, EXPORT));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(storage.downloadUrl).not.toHaveBeenCalled();
  });

  test('download works while access holds, and expired exports are refused', async () => {
    const { prisma, storage, svc } = setup();
    prisma.data_export.findFirst.mockResolvedValue(row());
    prisma.user_profile.findUnique.mockResolvedValue({ id: USER });
    prisma.student.findMany.mockResolvedValue([]);
    const res = await svc.download(USER, EXPORT);
    expect(res.url).toBe('https://signed.example/x');
    expect(storage.downloadUrl).toHaveBeenCalledTimes(1);

    prisma.data_export.findFirst.mockResolvedValue(row({ expires_at: new Date(Date.now() - 1000) }));
    expect(await expectRejection(svc.download(USER, EXPORT))).toBeInstanceOf(BadRequestException);
  });
});
