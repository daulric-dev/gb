import { describe, expect, test } from 'bun:test';
import {
  EVENT_GROUPS,
  eventTypeCatalog,
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
      expect({ key: t.key, problems: validateEventData(t.key, t.example) }).toEqual({ key: t.key, problems: [] });
    }
  });

  test('the owner-requested types are present; grades.released (no release step exists) is not', () => {
    for (const key of [
      'submission.handed_in', 'grade.recorded', 'quiz.completed',
      'attendance.session_opened', 'attendance.session_closed', 'attendance.recorded',
      'student.joined_school', 'student.left_school', 'student.enrolled', 'student.unenrolled',
      'staff.joined', 'staff.left', 'staff.role_changed',
      'course.created', 'course.archived', 'activity.published', 'announcement.posted', 'ping',
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
      expect(t.schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(t.example).toBeTruthy();
    }
  });

  test('"*" expands to every type but ping; unknown keys are refused; order and duplicates are normalised', () => {
    const all = expandEvents(['*']);
    expect(all).not.toContain('ping');
    expect(all).toHaveLength(WEBHOOK_EVENT_KEYS.length - 1);
    expect(expandEvents(['staff.left', 'course.created', 'staff.left'])).toEqual(['staff.left', 'course.created']);
    expect(() => expandEvents(['grades.released'])).toThrow(UnknownEventTypeError);
  });

  test('the validator reports wrong types, missing and extra keys, bad enums and formats', () => {
    const t = WEBHOOK_EVENT_TYPES.find((x) => x.key === 'staff.left')!;
    expect(validateSchema(t.schema, { ...t.example, extra: 1 })).toEqual(['data.extra: not allowed']);
    expect(validateSchema(t.schema, { staff: t.example.staff })).toEqual(['data.via: required']);
    expect(validateSchema(t.schema, { ...t.example, via: 'fired' })[0]).toContain('is not one of');
    expect(
      validateSchema(t.schema, { ...t.example, staff: { ...(t.example.staff as object), id: 'nope' } }),
    ).toEqual(['data.staff.id: not a uuid']);
    expect(validateSchema(t.schema, 'x')).toEqual(['data: expected object, got string']);
    expect(validateEventData('nope', {})).toEqual(['unknown event type "nope"']);
  });
});
