import { describe, test, expect } from 'bun:test';
import { FileShareNotifyHandler } from './file-share-notify.handler';
import { FileIngestHandler } from './file-ingest.handler';
import { createMockPrisma } from '@/test/prisma-mock';

const OWNER = 'owner';

function setup(principal_type: string, principal_id = 'p1') {
  const prisma = createMockPrisma();
  prisma.file_share.findUnique.mockResolvedValue({
    id: 'share-1',
    file_id: 'file-1',
    school_id: 'school-1',
    principal_type,
    principal_id,
    can_download: true,
  });
  prisma.file.findUnique.mockResolvedValue({
    id: 'file-1',
    name: 'Notes.pdf',
    owner_id: OWNER,
  });
  prisma.notification.createMany.mockImplementation(async ({ data }) => ({
    count: data.length,
  }));
  return { prisma, handler: new FileShareNotifyHandler(prisma as any) };
}

const recipients = (prisma: ReturnType<typeof createMockPrisma>) =>
  prisma.notification.createMany.mock.calls[0]?.[0].data.map(
    (r: { user_id: string }) => r.user_id,
  );

describe('FileShareNotifyHandler', () => {
  test('a user share notifies that user, skipping duplicates', async () => {
    const { prisma, handler } = setup('user', 'ta');
    await handler.run({ shareId: 'share-1' });
    const call = prisma.notification.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toEqual([
      expect.objectContaining({
        user_id: 'ta',
        share_id: 'share-1',
        file_id: 'file-1',
        school_id: 'school-1',
        type: 'file_share',
        title: '"Notes.pdf" was shared with you',
        body: 'You can view and download this file.',
        can_download: true,
      }),
    ]);
  });

  test('a role share notifies the role holders in the school, not the sharer', async () => {
    const { prisma, handler } = setup('role');
    prisma.school_management_role.findMany.mockResolvedValue([
      { school_management: { user_id: 'a' } },
      { school_management: { user_id: OWNER } },
    ]);
    await handler.run({ shareId: 'share-1' });
    expect(recipients(prisma)).toEqual(['a']);
    expect(
      prisma.school_management_role.findMany.mock.calls[0][0].where,
    ).toEqual({
      school_role_id: 'p1',
      school_management: { school_id: 'school-1' },
    });
  });

  test('a course share notifies member staff and active students', async () => {
    const { prisma, handler } = setup('course');
    prisma.course.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.course_staff.findMany.mockResolvedValue([
      { user_profile_id: OWNER },
      { user_profile_id: 'ta' },
      { user_profile_id: 'gone' },
    ]);
    prisma.school_management.findMany.mockResolvedValue([
      { user_id: OWNER },
      { user_id: 'ta' },
    ]);
    prisma.course_student.findMany.mockResolvedValue([
      { student: { user_profile_id: 's1' } },
    ]);
    await handler.run({ shareId: 'share-1' });
    expect(recipients(prisma)).toEqual(['ta', 's1']);
  });

  test('a legacy group share notifies no one', async () => {
    const { prisma, handler } = setup('group');
    await handler.run({ shareId: 'share-1' });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  test('a missing share is skipped', async () => {
    const { prisma, handler } = setup('user');
    prisma.file_share.findUnique.mockResolvedValue(null);
    await handler.run({ shareId: 'nope' });
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('FileIngestHandler', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const job = {
    schoolId: 'school-1',
    ownerId: OWNER,
    bucket: 'report-books',
    storagePath: 'school-1/r.pdf',
    name: 'Report.pdf',
    contentType: 'application/pdf',
    sizeBytes: 0,
    folderPath: ['Reports', '2026'],
  };

  test('records a stored object as a ready file under system folders', async () => {
    const prisma = createMockPrisma();
    let n = 0;
    prisma.folder.create.mockImplementation(async () => ({ id: `folder-${++n}` }));
    prisma.file.create.mockResolvedValue({ id: 'f' });
    const storage = { getBuffer: async () => PDF };
    await new FileIngestHandler(prisma as any, storage as any).run(job);
    const row = prisma.file.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      status: 'ready',
      source: 'report',
      folder_id: 'folder-2',
      size_bytes: PDF.byteLength,
    });
    expect(prisma.folder.create.mock.calls[1][0].data.parent_id).toBe('folder-1');
  });

  test('throws (so the job retries) while the object is missing', async () => {
    const prisma = createMockPrisma();
    const storage = { getBuffer: async () => null };
    await expect(
      new FileIngestHandler(prisma as any, storage as any).run(job),
    ).rejects.toThrow();
    expect(prisma.file.create).not.toHaveBeenCalled();
  });
});
