import { describe, expect, test } from 'bun:test';
import {
  EVENT_GROUPS,
  eventMessage,
  eventTypeCatalog,
  MAX_MESSAGE_LENGTH,
  expandEvents,
  UnknownEventTypeError,
  validateEventData,
  validateSchema,
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_EVENT_TYPES,
} from './webhook-event-types';

describe('webhook event type catalog', () => {
  test('every type is defined once with a group, label, description, schema and example', () => {
    expect(new Set(WEBHOOK_EVENT_KEYS).size).toBe(WEBHOOK_EVENT_KEYS.length);
    for (const t of WEBHOOK_EVENT_TYPES) {
      expect(t.key).toMatch(/^[a-z]+(\.[a-z_]+)?$/);
      expect(EVENT_GROUPS).toContain(t.group);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.schema.type).toBe('object');
    }
  });

  test('every example validates against its own schema', () => {
    for (const t of WEBHOOK_EVENT_TYPES) {
      expect({
        key: t.key,
        problems: validateEventData(t.key, t.example),
      }).toEqual({ key: t.key, problems: [] });
    }
  });

  test('the owner-requested types are present; grades.released (no release step exists) is not', () => {
    for (const key of [
      'submission.handed_in',
      'grade.recorded',
      'quiz.completed',
      'attendance.session_opened',
      'attendance.session_closed',
      'attendance.recorded',
      'student.joined_school',
      'student.left_school',
      'student.enrolled',
      'student.unenrolled',
      'staff.joined',
      'staff.left',
      'staff.role_changed',
      'course.created',
      'course.archived',
      'activity.published',
      'announcement.posted',
      'ping',
      'audit.changed',
    ]) {
      expect(WEBHOOK_EVENT_KEYS).toContain(key);
    }
    expect(WEBHOOK_EVENT_KEYS).not.toContain('grades.released');
  });

  test('the API catalog carries draft 2020-12 schemas and examples', () => {
    const c = eventTypeCatalog();
    expect(c.apiVersion).toBe(1);
    expect(c.groups.map((g) => g.key)).toEqual([...EVENT_GROUPS]);
    expect(c.eventTypes).toHaveLength(WEBHOOK_EVENT_TYPES.length);
    for (const t of c.eventTypes) {
      expect(t.schema.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
      expect(t.example).toBeTruthy();
    }
  });

  test('"*" expands to every type but ping; unknown keys are refused; order and duplicates are normalised', () => {
    const all = expandEvents(['*']);
    expect(all).not.toContain('ping');
    expect(all).toHaveLength(WEBHOOK_EVENT_KEYS.length - 1);
    expect(
      expandEvents(['staff.left', 'course.created', 'staff.left']),
    ).toEqual(['staff.left', 'course.created']);
    expect(() => expandEvents(['grades.released'])).toThrow(
      UnknownEventTypeError,
    );
  });

  test('the validator reports wrong types, missing and extra keys, bad enums and formats', () => {
    const t = WEBHOOK_EVENT_TYPES.find((x) => x.key === 'staff.left')!;
    expect(validateSchema(t.schema, { ...t.example, extra: 1 })).toEqual([
      'data.extra: not allowed',
    ]);
    expect(
      validateSchema(t.schema, {
        school: t.example.school,
        staff: t.example.staff,
      }),
    ).toEqual(['data.via: required']);
    expect(
      validateSchema(t.schema, { ...t.example, via: 'fired' })[0],
    ).toContain('is not one of');
    expect(
      validateSchema(t.schema, {
        ...t.example,
        staff: { ...(t.example.staff as object), id: 'nope' },
      }),
    ).toEqual(['data.staff.id: not a uuid']);
    expect(validateSchema(t.schema, 'x')).toEqual([
      'data: expected object, got string',
    ]);
    expect(validateEventData('nope', {})).toEqual([
      'unknown event type "nope"',
    ]);
  });
});

describe('event messages', () => {
  test('every example has a schema-valid school and a plain-text message of at most 280 characters', () => {
    for (const t of WEBHOOK_EVENT_TYPES) {
      expect(t.example.school).toEqual({
        id: expect.any(String),
        name: expect.any(String),
      });
      expect(t.schema.required).toContain('school');
      const m = eventMessage(t.key, t.example);
      expect(m.length).toBeGreaterThan(0);
      expect(m.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
      expect(m).not.toMatch(/[<>\n]/);
    }
    expect(
      eventTypeCatalog().eventTypes.every((t) => t.exampleMessage.length > 0),
    ).toBe(true);
  });

  const message = (key: string) =>
    eventMessage(key, WEBHOOK_EVENT_TYPES.find((t) => t.key === key)!.example);

  test('one example per group reads as a sentence', () => {
    expect(message('grade.recorded')).toBe(
      'Ada Lovelace received 17.5/20 for Quadratics homework in Year 10 Mathematics',
    );
    expect(message('submission.handed_in')).toBe(
      'Ada Lovelace handed in Quadratics homework in Year 10 Mathematics',
    );
    expect(message('attendance.recorded')).toBe(
      'Ada Lovelace was marked late in Year 10 Mathematics',
    );
    expect(message('attendance.session_closed')).toBe(
      'Attendance (Period 1) closed in Year 10 Mathematics: 24 present, 2 late, 3 absent, 1 excused',
    );
    expect(message('staff.role_changed')).toBe(
      "Grace Hopper's role changed from teacher to admin",
    );
    expect(message('student.joined_school')).toBe(
      'Ada Lovelace joined Riverside High School with the join code',
    );
    expect(message('course.archived')).toBe('Year 10 Mathematics was archived');
    expect(message('audit.changed')).toBe(
      'Grace Hopper updated term in Riverside High School',
    );
    expect(message('announcement.posted')).toBe(
      'Grace Hopper posted the announcement "Exam timetable published" in Year 10 Mathematics',
    );
    expect(message('ping')).toBe('Test event from GradeBook');
  });

  test('variants: excused, cleared, no points', () => {
    const base = WEBHOOK_EVENT_TYPES.find(
      (t) => t.key === 'grade.recorded',
    )!.example;
    const grade = (g: object) =>
      eventMessage('grade.recorded', {
        ...base,
        grade: { ...(base.grade as object), ...g },
      });
    expect(grade({ excused: true, score: null })).toBe(
      'Ada Lovelace was excused from Quadratics homework in Year 10 Mathematics',
    );
    expect(grade({ score: null })).toBe(
      "Ada Lovelace's mark for Quadratics homework in Year 10 Mathematics was cleared",
    );
    expect(grade({ points: null, score: 18 })).toBe(
      'Ada Lovelace received 18 for Quadratics homework in Year 10 Mathematics',
    );
  });

  test('missing names fall back gracefully; nothing at all falls back to the label', () => {
    expect(
      eventMessage('grade.recorded', { grade: { score: 18, points: 20 } }),
    ).toBe('A student received 18/20 for an activity in a course');
    expect(
      eventMessage('attendance.recorded', {
        student: { firstName: null, lastName: ' ' },
      }),
    ).toBe('A student was marked for attendance in a course');
    expect(eventMessage('staff.left', {})).toBe(
      'A staff member left the school',
    );
    expect(eventMessage('course.archived', null)).toBe('A course was archived');
    expect(
      eventMessage('student.enrolled', {
        student: { firstName: 'Ada', lastName: null },
      }),
    ).toBe('Ada was enrolled in a course');
    expect(eventMessage('nope', {})).toBe('GradeBook event nope');
  });

  test('line breaks are collapsed and long messages are cut to 280 characters', () => {
    const m = eventMessage('course.archived', {
      course: { name: `Line\none ${'x'.repeat(400)}` },
    });
    expect(m.startsWith('Line one x')).toBe(true);
    expect(m.length).toBe(MAX_MESSAGE_LENGTH);
    expect(m.endsWith('…')).toBe(true);
  });
});
