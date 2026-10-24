import { describe, expect, test } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ROW = {
  id: 'ann-1',
  school_id: 'school-1',
  course_id: 'course-1',
  author_user_profile_id: 'ta-1',
  title: 'Old',
  body: null,
  created_at: new Date('2026-10-20'),
  updated_at: new Date('2026-10-20'),
  user_profile: null,
};

/** Course access is tested on its own; this stand-in hands back a role. */
function service(prisma: MockPrisma, role: string | null) {
  const access = {
    require: async () => {
      if (!role) throw new NotFoundException('Course not found');
      return { course: { id: 'course-1', school_id: 'school-1' }, role };
    },
  };
  const cache = { delete: async () => undefined };
  return new AnnouncementService(prisma as any, cache as any, access as any);
}

function seed(prisma: MockPrisma) {
  prisma.announcement.findFirst.mockResolvedValue({
    author_user_profile_id: 'ta-1',
  });
  prisma.announcement.update.mockResolvedValue({ ...ROW, title: 'New' });
  prisma.announcement.delete.mockResolvedValue(ROW);
  prisma.announcement_read.findMany.mockResolvedValue([]);
}

describe('AnnouncementService course announcements', () => {
  test("a course teacher can edit a TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const out = await service(prisma, 'teacher').updateForCourse(
      'teacher-1',
      'course-1',
      'ann-1',
      { title: 'New' },
    );
    expect(out.title).toBe('New');
    expect(prisma.announcement.findFirst.mock.calls[0][0].where).toEqual({
      id: 'ann-1',
      course_id: 'course-1',
    });
  });

  test("a course teacher can delete a TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    await service(prisma, 'teacher').deleteForCourse(
      'teacher-1',
      'course-1',
      'ann-1',
    );
    expect(prisma.announcement.delete).toHaveBeenCalled();
  });

  test('a TA edits their own announcement', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    await service(prisma, 'ta').updateForCourse('ta-1', 'course-1', 'ann-1', {
      title: 'New',
    });
    expect(prisma.announcement.update).toHaveBeenCalled();
  });

  test("a TA cannot change another TA's announcement", async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma, 'ta').deleteForCourse('ta-2', 'course-1', 'ann-1'),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(prisma.announcement.delete).not.toHaveBeenCalled();
  });

  test('an announcement from another course is a 404', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    prisma.announcement.findFirst.mockResolvedValue(null);
    const err = await expectRejection(
      service(prisma, 'teacher').updateForCourse(
        'teacher-1',
        'course-1',
        'ann-1',
        { title: 'New' },
      ),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('someone with no course role is a 404', async () => {
    const prisma = createMockPrisma();
    seed(prisma);
    const err = await expectRejection(
      service(prisma, null).deleteForCourse('x', 'course-1', 'ann-1'),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });
});
