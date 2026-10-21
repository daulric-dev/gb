import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ModuleService } from './module.service';
import { STAFF_ROLES, type CourseRole } from './access/course-access.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const USER = 'user-1';
const COURSE = 'course-1';
const COURSE_ROW = { id: COURSE, school_id: 'school-1' };

/** Course access that enforces roles the way CourseAccessService does. */
function fakeAccess(role: CourseRole | null) {
  return {
    require: async (
      _u: string,
      _c: string,
      allowed: readonly CourseRole[] = STAFF_ROLES,
    ) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!allowed.includes(role)) throw new ForbiddenException('no');
      return { course: COURSE_ROW, role };
    },
  } as any;
}

function service(prisma: MockPrisma, role: CourseRole | null = 'teacher') {
  return new ModuleService(prisma as any, fakeAccess(role));
}

function item(over: Record<string, any> = {}) {
  return {
    id: 'i1',
    module_id: 'm1',
    course_id: COURSE,
    position: 0,
    item_type: 'header',
    title: 'Intro',
    page_id: null,
    activity_id: null,
    file_id: null,
    url: null,
    indent: 0,
    is_published: true,
    page: null,
    activity: null,
    file: null,
    ...over,
  };
}

const PAGES: Record<string, any> = {
  p1: { id: 'p1', title: 'Welcome', is_published: true },
  p2: { id: 'p2', title: 'Unfinished', is_published: false },
};
const ACTIVITIES: Record<string, any> = {
  a1: {
    id: 'a1',
    title: 'Essay',
    kind: 'assignment',
    points: { toString: () => '20' }, // a Decimal
    due_at: new Date('2026-11-01T12:00:00Z'),
    status: 'published',
  },
  a2: { id: 'a2', title: 'Quiz', kind: 'quiz', points: 10, due_at: null, status: 'draft' },
};

const MODULES = [
  { id: 'm1', course_id: COURSE, title: 'Week 1', position: 0, is_published: true },
  { id: 'm2', course_id: COURSE, title: 'Week 2', position: 1, is_published: false },
];

const ITEMS = [
  item({ id: 'i1' }),
  item({ id: 'i2', item_type: 'page', title: null, page_id: 'p1', page: PAGES.p1, position: 1 }),
  item({ id: 'i3', item_type: 'page', title: null, page_id: 'p2', page: PAGES.p2, position: 2 }),
  item({ id: 'i4', item_type: 'activity', title: null, activity_id: 'a1', activity: ACTIVITIES.a1, position: 3 }),
  item({ id: 'i5', item_type: 'activity', title: 'Custom', activity_id: 'a2', activity: ACTIVITIES.a2, position: 4 }),
  item({
    id: 'i6',
    item_type: 'file',
    title: null,
    file_id: 'f1',
    file: { id: 'f1', name: 'notes.pdf', deleted_at: null },
    position: 5,
  }),
  item({
    id: 'i8',
    item_type: 'file',
    title: null,
    file_id: 'f2',
    file: { id: 'f2', name: 'gone.pdf', deleted_at: new Date() },
    position: 6,
  }),
  item({ id: 'i7', module_id: 'm2', title: 'Later' }),
];

function content(): MockPrisma {
  const prisma = createMockPrisma();
  prisma.module.findMany.mockResolvedValue(MODULES);
  prisma.module_item.findMany.mockResolvedValue(ITEMS);
  return prisma;
}

describe('ModuleService.list', () => {
  test('staff see every module and item with resolved titles', async () => {
    const prisma = content();
    const modules = await service(prisma, 'ta').list(USER, COURSE);

    expect(modules.map((m) => m.id)).toEqual(['m1', 'm2']);
    const titles = modules[0].items.map((i) => i.title);
    expect(titles).toEqual([
      'Intro',
      'Welcome',
      'Unfinished',
      'Essay',
      'Custom',
      'notes.pdf',
      // A deleted file's name is not shown.
      'Untitled',
    ]);

    const essay = modules[0].items.find((i) => i.id === 'i4')!;
    expect(essay.activity).toEqual({
      kind: 'assignment',
      points: 20,
      dueAt: '2026-11-01T12:00:00.000Z',
      status: 'published',
    });
    expect(modules[0].items[0].activity).toBeUndefined();
    expect(modules[0].items[0]).toEqual({
      id: 'i1',
      moduleId: 'm1',
      position: 0,
      itemType: 'header',
      title: 'Intro',
      pageId: null,
      activityId: null,
      fileId: null,
      url: null,
      indent: 0,
      isPublished: true,
    });
    expect(modules[1].items.map((i) => i.id)).toEqual(['i7']);
    expect(prisma.module.findMany.mock.calls[0][0].where).toEqual({
      course_id: COURSE,
    });
  });

  test('students see no unpublished pages, draft activities or deleted files', async () => {
    const prisma = content();
    const modules = await service(prisma).listForStudent(COURSE);
    const ids = modules[0].items.map((i) => i.id);
    expect(ids).toEqual(['i1', 'i2', 'i4', 'i6']);

    expect(prisma.module.findMany.mock.calls[0][0].where.is_published).toBe(true);
    expect(prisma.module_item.findMany.mock.calls[0][0].where.is_published).toBe(true);
  });

  test('someone with no course role gets a 404', async () => {
    const prisma = content();
    expect(
      await expectRejection(service(prisma, null).list(USER, COURSE)),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a failed query is a 400', async () => {
    const prisma = content();
    prisma.module_item.findMany.mockRejectedValue(new Error('boom'));
    expect(
      await expectRejection(service(prisma).list(USER, COURSE)),
    ).toBeInstanceOf(BadRequestException);
  });
});

describe('ModuleService writes', () => {
  test('a TA cannot create modules', async () => {
    const prisma = content();
    expect(
      await expectRejection(service(prisma, 'ta').create(USER, COURSE, 'Week 3')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a new module goes after the last one', async () => {
    const prisma = createMockPrisma();
    prisma.module.findFirst.mockResolvedValue({ position: 4 });
    prisma.module.create.mockImplementation(async ({ data }: any) => ({
      id: 'm3',
      is_published: false,
      ...data,
    }));
    const created = await service(prisma).create(USER, COURSE, ' Week 3 ');
    expect(prisma.module.create.mock.calls[0][0].data).toEqual({
      course_id: COURSE,
      title: 'Week 3',
      position: 5,
    });
    expect(created).toEqual({
      id: 'm3',
      courseId: COURSE,
      title: 'Week 3',
      position: 5,
      isPublished: false,
      items: [],
    });
  });

  test('the first module goes at position 0', async () => {
    const prisma = createMockPrisma();
    prisma.module.create.mockImplementation(async ({ data }: any) => ({
      id: 'm1',
      is_published: false,
      ...data,
    }));
    await service(prisma).create(USER, COURSE, 'Week 1');
    expect(prisma.module.create.mock.calls[0][0].data.position).toBe(0);
  });

  test('reorder must list every module exactly once', async () => {
    const prisma = createMockPrisma();
    prisma.module.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    const svc = service(prisma);
    for (const ids of [['m1'], ['m1', 'm1'], ['m1', 'mX']]) {
      expect(await expectRejection(svc.reorder(USER, COURSE, ids))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.module.updateMany).not.toHaveBeenCalled();
  });

  test('reorder writes positions in the given order', async () => {
    const prisma = createMockPrisma();
    prisma.module.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    await service(prisma).reorder(USER, COURSE, ['m2', 'm1']);
    const updates = prisma.module.updateMany.mock.calls.map((c: any) => [
      c[0].where.id,
      c[0].data.position,
    ]);
    expect(updates).toEqual([
      ['m2', 0],
      ['m1', 1],
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('ModuleService items', () => {
  function withModule() {
    const prisma = createMockPrisma();
    prisma.module.findFirst.mockResolvedValue({
      id: 'm1',
      course_id: COURSE,
      title: 'W',
      position: 0,
      is_published: true,
    });
    return prisma;
  }

  test('a page from another course is refused', async () => {
    const prisma = withModule();
    expect(
      await expectRejection(
        service(prisma).createItem(USER, COURSE, 'm1', { itemType: 'page', pageId: 'p9' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(prisma.page.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p9',
      course_id: COURSE,
    });
  });

  test('a file must be the caller\'s own, in the course school and not deleted', async () => {
    const prisma = withModule();
    expect(
      await expectRejection(
        service(prisma).createItem(USER, COURSE, 'm1', { itemType: 'file', fileId: 'f9' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(prisma.file.findFirst.mock.calls[0][0].where).toEqual({
      id: 'f9',
      school_id: 'school-1',
      owner_id: USER,
      deleted_at: null,
    });
  });

  test('a link needs a title and a URL', async () => {
    const prisma = withModule();
    const svc = service(prisma);
    expect(
      await expectRejection(
        svc.createItem(USER, COURSE, 'm1', { itemType: 'link', url: 'https://x.test' }),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await expectRejection(
        svc.createItem(USER, COURSE, 'm1', { itemType: 'link', title: 'X' }),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  test('an activity item keeps only the activity pointer and goes last', async () => {
    const prisma = withModule();
    prisma.activity.findFirst.mockResolvedValue({ id: 'a1' });
    prisma.module_item.findFirst.mockResolvedValue({ position: 2 });
    prisma.module_item.create.mockImplementation(async ({ data }: any) =>
      item({
        ...data,
        id: 'new',
        activity: { id: 'a1', title: 'Essay', kind: 'assignment', points: 20, due_at: null, status: 'draft' },
      }),
    );
    const created = await service(prisma).createItem(USER, COURSE, 'm1', {
      itemType: 'activity',
      activityId: 'a1',
      pageId: 'stray',
      url: 'https://ignored.test',
    });

    expect(prisma.module_item.create.mock.calls[0][0].data).toMatchObject({
      item_type: 'activity',
      activity_id: 'a1',
      page_id: null,
      url: null,
      position: 3,
      module_id: 'm1',
      course_id: COURSE,
    });
    expect(created.title).toBe('Essay');
    expect(created.activity?.status).toBe('draft');
  });

  test('moving an item checks the target module and appends it', async () => {
    const prisma = createMockPrisma();
    prisma.module.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === 'm2' ? null : { id: 'm1', course_id: COURSE },
    );
    prisma.module_item.findFirst.mockResolvedValue(item());
    expect(
      await expectRejection(
        service(prisma).updateItem(USER, COURSE, 'm1', 'i1', { moduleId: 'm2' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(prisma.module_item.update).not.toHaveBeenCalled();
  });

  test('a missing item is a 404', async () => {
    const prisma = createMockPrisma();
    expect(
      await expectRejection(
        service(prisma).removeItem(USER, COURSE, 'm1', 'i9'),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a header cannot lose its title', async () => {
    const prisma = createMockPrisma();
    prisma.module_item.findFirst.mockResolvedValue(item());
    expect(
      await expectRejection(
        service(prisma).updateItem(USER, COURSE, 'm1', 'i1', { title: null }),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});
