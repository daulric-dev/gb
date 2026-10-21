import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ModuleService } from './module.service';
import { STAFF_ROLES, type CourseRole } from './access/course-access.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

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

function service(sb: any, role: CourseRole | null = 'teacher') {
  return new ModuleService(sb, fakeAccess(role));
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
    ...over,
  };
}

const MODULES = {
  data: [
    { id: 'm1', course_id: COURSE, title: 'Week 1', position: 0, is_published: true },
    { id: 'm2', course_id: COURSE, title: 'Week 2', position: 1, is_published: false },
  ],
  error: null,
};

const CONTENT_TABLES = {
  'course.module': MODULES,
  'course.module_item': {
    data: [
      item({ id: 'i1' }),
      item({ id: 'i2', item_type: 'page', title: null, page_id: 'p1', position: 1 }),
      item({ id: 'i3', item_type: 'page', title: null, page_id: 'p2', position: 2 }),
      item({ id: 'i4', item_type: 'activity', title: null, activity_id: 'a1', position: 3 }),
      item({ id: 'i5', item_type: 'activity', title: 'Custom', activity_id: 'a2', position: 4 }),
      item({ id: 'i6', item_type: 'file', title: null, file_id: 'f1', position: 5 }),
      item({ id: 'i7', module_id: 'm2', title: 'Later' }),
    ],
    error: null,
  },
  'course.page': {
    data: [
      { id: 'p1', title: 'Welcome', is_published: true },
      { id: 'p2', title: 'Unfinished', is_published: false },
    ],
    error: null,
  },
  'grading.activity': {
    data: [
      { id: 'a1', title: 'Essay', kind: 'assignment', points: '20', due_at: null, status: 'published' },
      { id: 'a2', title: 'Quiz', kind: 'quiz', points: 10, due_at: null, status: 'draft' },
    ],
    error: null,
  },
  'file_manager.file': { data: [{ id: 'f1', name: 'notes.pdf' }], error: null },
};

describe('ModuleService.list', () => {
  test('staff see every module and item with resolved titles', async () => {
    const sb = createRoutingSupabase({ tables: CONTENT_TABLES });
    const modules = await service(sb, 'ta').list(USER, COURSE);

    expect(modules.map((m) => m.id)).toEqual(['m1', 'm2']);
    const titles = modules[0].items.map((i) => i.title);
    expect(titles).toEqual([
      'Intro',
      'Welcome',
      'Unfinished',
      'Essay',
      'Custom',
      'notes.pdf',
    ]);

    const essay = modules[0].items.find((i) => i.id === 'i4')!;
    expect(essay.activity).toEqual({
      kind: 'assignment',
      points: 20,
      dueAt: null,
      status: 'published',
    });
    expect(modules[0].items[0].activity).toBeUndefined();
    expect(modules[1].items.map((i) => i.id)).toEqual(['i7']);
  });

  test('students see no unpublished pages or draft activities', async () => {
    const sb = createRoutingSupabase({ tables: CONTENT_TABLES });
    const modules = await service(sb).listForStudent(COURSE);
    const ids = modules[0].items.map((i) => i.id);
    expect(ids).toEqual(['i1', 'i2', 'i4', 'i6']);

    const moduleQuery = sb._calls.find((c: any) => c.table === 'module');
    expect(moduleQuery?.filters.is_published).toBe(true);
    const itemQuery = sb._calls.find((c: any) => c.table === 'module_item');
    expect(itemQuery?.filters.is_published).toBe(true);
  });

  test('someone with no course role gets a 404', async () => {
    const sb = createRoutingSupabase({ tables: CONTENT_TABLES });
    expect(
      await expectRejection(service(sb, null).list(USER, COURSE)),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('ModuleService writes', () => {
  test('a TA cannot create modules', async () => {
    const sb = createRoutingSupabase({ tables: CONTENT_TABLES });
    expect(
      await expectRejection(service(sb, 'ta').create(USER, COURSE, 'Week 3')),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('a new module goes after the last one', async () => {
    const sb = createRoutingSupabase({
      tables: {
        'course.module': (call: any) =>
          call.op === 'insert'
            ? {
                data: { id: 'm3', course_id: COURSE, title: 'Week 3', position: 5, is_published: false },
                error: null,
              }
            : { data: [{ position: 4 }], error: null },
      },
    });
    const created = await service(sb).create(USER, COURSE, ' Week 3 ');
    const insert = sb._calls.find((c: any) => c.op === 'insert');
    expect(insert?.payload).toEqual({ course_id: COURSE, title: 'Week 3', position: 5 });
    expect(created.items).toEqual([]);
  });

  test('reorder must list every module exactly once', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.module': { data: [{ id: 'm1' }, { id: 'm2' }], error: null } },
    });
    const svc = service(sb);
    for (const ids of [['m1'], ['m1', 'm1'], ['m1', 'mX']]) {
      expect(await expectRejection(svc.reorder(USER, COURSE, ids))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(sb._calls.some((c: any) => c.op === 'update')).toBe(false);
  });

  test('reorder writes positions in the given order', async () => {
    const sb = createRoutingSupabase({
      tables: {
        'course.module': (call: any) =>
          call.op === 'update' ? { data: null, error: null } : { data: [{ id: 'm1' }, { id: 'm2' }], error: null },
        'course.module_item': { data: [], error: null },
      },
    });
    await service(sb).reorder(USER, COURSE, ['m2', 'm1']);
    const updates = sb._calls.filter((c: any) => c.op === 'update');
    expect(updates.map((u: any) => [u.filters.id, u.payload.position])).toEqual([
      ['m2', 0],
      ['m1', 1],
    ]);
  });
});

describe('ModuleService items', () => {
  const base = {
    'course.module': {
      data: { id: 'm1', course_id: COURSE, title: 'W', position: 0, is_published: true },
      error: null,
    },
  };

  test('a page from another course is refused', async () => {
    const sb = createRoutingSupabase({
      tables: { ...base, 'course.page': { data: null, error: null } },
    });
    expect(
      await expectRejection(
        service(sb).createItem(USER, COURSE, 'm1', { itemType: 'page', pageId: 'p9' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    const lookup = sb._calls.find((c: any) => c.table === 'page');
    expect(lookup?.filters).toMatchObject({ id: 'p9', course_id: COURSE });
  });

  test('a file must be in the course school and not deleted', async () => {
    const sb = createRoutingSupabase({
      tables: { ...base, 'file_manager.file': { data: null, error: null } },
    });
    expect(
      await expectRejection(
        service(sb).createItem(USER, COURSE, 'm1', { itemType: 'file', fileId: 'f9' }),
      ),
    ).toBeInstanceOf(NotFoundException);
    const lookup = sb._calls.find((c: any) => c.table === 'file');
    expect(lookup?.filters).toMatchObject({ id: 'f9', school_id: 'school-1' });
  });

  test('a link needs a title and a URL', async () => {
    const sb = createRoutingSupabase({ tables: base });
    const svc = service(sb);
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
    const sb = createRoutingSupabase({
      tables: {
        ...base,
        'grading.activity': (call: any) =>
          call.filters.id
            ? { data: { id: 'a1' }, error: null }
            : {
                data: [{ id: 'a1', title: 'Essay', kind: 'assignment', points: 20, due_at: null, status: 'draft' }],
                error: null,
              },
        'course.module_item': (call: any) =>
          call.op === 'insert'
            ? { data: item({ ...call.payload, id: 'new' }), error: null }
            : { data: [{ position: 2 }], error: null },
      },
    });
    const created = await service(sb).createItem(USER, COURSE, 'm1', {
      itemType: 'activity',
      activityId: 'a1',
      pageId: 'stray',
      url: 'https://ignored.test',
    });

    const insert = sb._calls.find((c: any) => c.op === 'insert');
    expect(insert?.payload).toMatchObject({
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
    const sb = createRoutingSupabase({
      tables: {
        'course.module': (call: any) =>
          call.filters.id === 'm2'
            ? { data: null, error: null }
            : { data: { id: 'm1', course_id: COURSE }, error: null },
        'course.module_item': { data: item(), error: null },
      },
    });
    expect(
      await expectRejection(
        service(sb).updateItem(USER, COURSE, 'm1', 'i1', { moduleId: 'm2' }),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  test('a header cannot lose its title', async () => {
    const sb = createRoutingSupabase({
      tables: { 'course.module_item': { data: item(), error: null } },
    });
    expect(
      await expectRejection(
        service(sb).updateItem(USER, COURSE, 'm1', 'i1', { title: null }),
      ),
    ).toBeInstanceOf(BadRequestException);
  });
});
