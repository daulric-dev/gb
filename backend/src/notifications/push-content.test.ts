import { describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import { genericData, isGeneric, pushContentFor } from './push-content';
import { mergeOff, optedOut, prefsFromRow } from './notification-preferences';
import { presentPush, pushCategoryOf } from './push.service';

describe('push content', () => {
  test('unset: generic only when sensitive; set: applies to everything', () => {
    expect(isGeneric(null, true)).toBe(true);
    expect(isGeneric(null, false)).toBe(false);
    expect(isGeneric('generic', false)).toBe(true);
    expect(isGeneric('full', true)).toBe(false);
  });

  test('generic data keeps only the type, ids and route', () => {
    expect(
      genericData({ type: 'parent.absence', studentId: 's1', childName: 'Ann', route: '/parent', nested: { id: 'x' } }),
    ).toEqual({ type: 'parent.absence', studentId: 's1', route: '/parent', generic: true });
  });

  test('presentPush replaces title and body', () => {
    const shown = presentPush({ title: 'Ann: absent', body: 'Ann missed Maths', data: { studentId: 's1' } }, true);
    expect(shown).toMatchObject({ title: 'GradeBook', body: 'You have a new update', data: { studentId: 's1', generic: true } });
    expect(presentPush({ title: 'a', body: 'b' }, false)).toEqual({ title: 'a', body: 'b' });
  });

  test('category is inferred for attendance pushes only', () => {
    expect(pushCategoryOf({ title: '', body: '', channelId: 'attendance' })).toBe('attendance');
    expect(pushCategoryOf({ title: '', body: '', data: { type: 'attendance.opened' } })).toBe('attendance');
    expect(pushCategoryOf({ title: '', body: '' })).toBeUndefined();
    expect(pushCategoryOf({ title: '', body: '', category: 'grades' })).toBe('grades');
  });

  test('effective setting: school, else organisation, else null', async () => {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ push_content: 'generic' });
    prisma.school.findMany.mockResolvedValue([
      { id: 'a', push_content: 'full' },
      { id: 'b', push_content: null },
      { id: 'c', push_content: 'nonsense' },
    ]);
    const out = await pushContentFor(prisma as any, ['a', 'b', 'c', null]);
    expect(out.get('a')).toBe('full');
    expect(out.get('b')).toBe('generic');
    expect(out.get('c')).toBe('generic');
    expect(out.get(null)).toBe('generic');
  });
});

describe('notification preferences', () => {
  test('no row = everything on', () => {
    const p = prefsFromRow(null);
    expect(Object.values(p.push).every(Boolean)).toBe(true);
    expect(Object.values(p.email).every(Boolean)).toBe(true);
  });

  test('merging a patch: only known categories and booleans, stable order', () => {
    expect(mergeOff(['chat'], { grades: false, chat: true, bogus: false, attendance: 'no' as any })).toEqual(['grades']);
    expect(mergeOff(undefined, { chat: false, announcements: false })).toEqual(['announcements', 'chat']);
  });

  test('optedOut queries the right column', async () => {
    const prisma = createMockPrisma();
    prisma.notification_preference.findMany.mockResolvedValue([{ user_profile_id: 'u2' }]);
    const out = await optedOut(prisma as any, ['u1', 'u2'], 'attendance', 'email');
    expect([...out]).toEqual(['u2']);
    expect(prisma.notification_preference.findMany.mock.calls[0][0].where).toEqual({
      user_profile_id: { in: ['u1', 'u2'] },
      email_off: { has: 'attendance' },
    });
    expect(await optedOut(prisma as any, [], 'attendance', 'push')).toEqual(new Set());
  });
});
