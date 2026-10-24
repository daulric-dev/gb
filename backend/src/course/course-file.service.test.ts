import { describe, expect, test } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseFileService } from './course-file.service';
import { STAFF_ROLES, type CourseRole } from './access/course-access.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const USER = 'teacher-2';
const COURSE = 'course-1';

function setup(role: CourseRole | null = 'teacher') {
  const prisma = createMockPrisma();
  const access = {
    require: async (
      _u: string,
      _c: string,
      allowed: readonly CourseRole[] = STAFF_ROLES,
    ) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!allowed.includes(role)) throw new ForbiddenException('no');
      return { course: { id: COURSE }, role };
    },
  };
  const reads: string[] = [];
  const files = {
    readContentForAuthorisedCaller: async (id: string) => {
      reads.push(id);
      return { buffer: Buffer.from('x'), contentType: 'text/plain', filename: 'a.txt' };
    },
  };
  const svc = new CourseFileService(prisma as any, access as any, files as any);
  return { prisma, svc, reads };
}

describe('CourseFileService', () => {
  test("a TA opens a colleague's file linked in the course, drafts included", async () => {
    const { prisma, svc, reads } = setup('ta');
    prisma.module_item.findFirst.mockResolvedValue({ id: 'item-1' });
    await svc.read(USER, COURSE, 'file-1');
    expect(prisma.module_item.findFirst.mock.calls[0][0].where).toEqual({
      course_id: COURSE,
      file_id: 'file-1',
    });
    expect(reads).toEqual(['file-1']);
  });

  test('a file shared with the course opens', async () => {
    const { prisma, svc, reads } = setup();
    prisma.file_share.findFirst.mockResolvedValue({ id: 'share-1' });
    await svc.read(USER, COURSE, 'file-1');
    expect(prisma.file_share.findFirst.mock.calls[0][0].where).toEqual({
      file_id: 'file-1',
      principal_type: 'course',
      principal_id: COURSE,
    });
    expect(reads).toEqual(['file-1']);
  });

  test('the caller’s own file opens', async () => {
    const { prisma, svc, reads } = setup();
    prisma.file.findFirst.mockResolvedValue({ id: 'file-1' });
    await svc.read(USER, COURSE, 'file-1');
    expect(prisma.file.findFirst.mock.calls[0][0].where).toEqual({
      id: 'file-1',
      owner_id: USER,
      deleted_at: null,
    });
    expect(reads).toEqual(['file-1']);
  });

  test('an unrelated file is not found', async () => {
    const { svc, reads } = setup();
    expect(await expectRejection(svc.read(USER, COURSE, 'file-9'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(reads).toEqual([]);
  });

  test('someone outside the course is turned away first', async () => {
    const { prisma, svc } = setup(null);
    expect(await expectRejection(svc.read(USER, COURSE, 'file-1'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.module_item.findFirst).not.toHaveBeenCalled();
  });
});
