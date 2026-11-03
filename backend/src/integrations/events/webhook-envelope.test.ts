import { describe, expect, test } from 'bun:test';
import { buildEnvelope, envelopeBody, isLegacyEnvelope, toEnvelope } from './webhook-envelope';

const SCHOOL = { id: '11111111-1111-4111-8111-111111111111', name: 'Riverside' };
const COURSE = { id: '22222222-2222-4222-8222-222222222222', name: 'Maths', code: null };

describe('webhook envelope', () => {
  test('the body has exactly event_type, message and data, in that order', () => {
    const e = buildEnvelope('course.archived', { school: SCHOOL, course: COURSE });
    const body = envelopeBody({ data: e.data, message: e.message, event_type: e.event_type } as never);
    expect(Object.keys(JSON.parse(body))).toEqual(['event_type', 'message', 'data']);
    expect(JSON.parse(body)).toEqual({
      event_type: 'course.archived',
      message: 'Maths was archived',
      data: { school: SCHOOL, course: COURSE },
    });
  });

  test('an old-shape payload converts: school into data, message built, id / apiVersion / createdAt dropped', () => {
    const legacy = {
      id: 'evt-1',
      type: 'course.archived',
      apiVersion: 1,
      createdAt: '2026-11-01T10:00:00.000Z',
      school: SCHOOL,
      data: { course: COURSE },
    };
    expect(isLegacyEnvelope(legacy)).toBe(true);
    const { envelope, converted } = toEnvelope(legacy, 'course.archived');
    expect(converted).toBe(true);
    expect(envelope).toEqual({ event_type: 'course.archived', message: 'Maths was archived', data: { school: SCHOOL, course: COURSE } });
    expect(Object.keys(envelope.data)[0]).toBe('school');
  });

  test('a new-shape payload is sent as stored', () => {
    const stored = { event_type: 'ping', message: 'Test event from GradeBook', data: { school: SCHOOL } };
    expect(isLegacyEnvelope(stored)).toBe(false);
    expect(toEnvelope(stored, 'ping')).toEqual({ envelope: stored, converted: false });
    // Garbage still yields a valid body.
    expect(toEnvelope(null, 'ping').envelope).toEqual({ event_type: 'ping', message: 'Test event from GradeBook', data: {} });
  });
});
