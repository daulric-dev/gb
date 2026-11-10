import { describe, expect, test } from 'bun:test';
import {
  addDays,
  daysBetween,
  isIsoDate,
  isValidTimeZone,
  isoWeekday,
  localParts,
  safeTimeZone,
  zonedToUtc,
} from './time-zone';

describe('time zones', () => {
  test('validates IANA names', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('America/Barbados')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(safeTimeZone('nope')).toBe('UTC');
  });

  test('local wall time to UTC, both sides of a DST change', () => {
    // London: GMT in winter, BST (UTC+1) in summer.
    expect(zonedToUtc('2026-01-12', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-01-12T09:00:00.000Z',
    );
    expect(zonedToUtc('2026-06-15', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-06-15T08:00:00.000Z',
    );
    // The Monday after clocks go back (25 Oct 2026) and forward (29 Mar 2026).
    expect(zonedToUtc('2026-10-26', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
    expect(zonedToUtc('2026-03-30', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-03-30T08:00:00.000Z',
    );
    // New York, west of UTC.
    expect(zonedToUtc('2026-11-09', 8 * 60 + 30, 'America/New_York').toISOString()).toBe(
      '2026-11-09T13:30:00.000Z',
    );
  });

  test('a skipped time lands after the gap; a repeated time is the first one', () => {
    // 01:30 does not exist in London on 29 Mar 2026.
    const gap = zonedToUtc('2026-03-29', 90, 'Europe/London');
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 01:30 happens twice on 25 Oct 2026; the first is BST (00:30Z).
    expect(zonedToUtc('2026-10-25', 90, 'Europe/London').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  test('local parts of an instant', () => {
    const p = localParts(new Date('2026-11-09T23:30:00Z'), 'Asia/Tokyo');
    expect(p).toEqual({ date: '2026-11-10', minute: 8 * 60 + 30, weekday: 2 });
  });

  test('calendar-day arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-01', '2026-11-09')).toBe(8);
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });
});
