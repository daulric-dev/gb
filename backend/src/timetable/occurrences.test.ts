import { describe, expect, test } from 'bun:test';
import {
  SchoolCalendar,
  occurrenceInstants,
  occurrencesBetween,
  type EntryInput,
  type OverrideInput,
  type PeriodTimes,
} from './occurrences';

// 2026-11-09 is a Monday.
const MON = '2026-11-09';

const period = (id: string, days: number[], start = 540, end = 600): PeriodTimes => ({
  id,
  name: id,
  position: 0,
  times: new Map(days.map((d) => [d, { start, end }])),
});

const weekly = (over: Partial<EntryInput> = {}): EntryInput => ({
  id: 'e1',
  courseId: 'c1',
  periodId: 'p1',
  roomId: 'r1',
  weekday: 1,
  cycleDay: null,
  from: null,
  to: null,
  ...over,
});

const base = {
  settings: { cycleLength: null, cycleStartDate: null, schoolDays: [1, 2, 3, 4, 5] },
  closures: [] as { startDate: string; endDate: string }[],
  periods: new Map([['p1', period('p1', [1, 2, 3, 4, 5])]]),
  overrides: [] as OverrideInput[],
};

describe('weekly timetable', () => {
  test('one occurrence per matching weekday', () => {
    const out = occurrencesBetween(MON, '2026-11-22', { ...base, entries: [weekly()] });
    expect(out.map((o) => o.date)).toEqual(['2026-11-09', '2026-11-16']);
    expect(out[0]).toMatchObject({ startMinute: 540, endMinute: 600, roomId: 'r1', status: 'scheduled' });
  });

  test('respects entry / term bounds', () => {
    const out = occurrencesBetween(MON, '2026-11-30', {
      ...base,
      entries: [weekly({ from: '2026-11-10', to: '2026-11-23' })],
    });
    expect(out.map((o) => o.date)).toEqual(['2026-11-16', '2026-11-23']);
  });

  test('no occurrence on a weekday without a period time (different schedule per day)', () => {
    const periods = new Map([['p1', period('p1', [1, 2, 3, 4])]]); // no Friday time
    const friday = weekly({ weekday: 5 });
    expect(occurrencesBetween(MON, '2026-11-15', { ...base, periods, entries: [friday] })).toEqual([]);
  });

  test('per-weekday times differ', () => {
    const p: PeriodTimes = {
      id: 'p1',
      name: 'P1',
      position: 0,
      times: new Map([
        [1, { start: 540, end: 600 }],
        [3, { start: 510, end: 560 }],
      ]),
    };
    const out = occurrencesBetween(MON, '2026-11-13', {
      ...base,
      periods: new Map([['p1', p]]),
      entries: [weekly({ id: 'a' }), weekly({ id: 'b', weekday: 3 })],
    });
    expect(out.map((o) => [o.date, o.startMinute])).toEqual([
      ['2026-11-09', 540],
      ['2026-11-11', 510],
    ]);
  });

  test('closures and non-school days are skipped', () => {
    const out = occurrencesBetween(MON, '2026-11-30', {
      ...base,
      closures: [{ startDate: '2026-11-16', endDate: '2026-11-20' }],
      entries: [weekly()],
    });
    expect(out.map((o) => o.date)).toEqual(['2026-11-09', '2026-11-23', '2026-11-30']);
    const sat = occurrencesBetween(MON, '2026-11-15', { ...base, entries: [weekly({ weekday: 6 })] });
    expect(sat).toEqual([]);
  });
});

describe('rotating timetable', () => {
  const settings = { cycleLength: 2, cycleStartDate: MON, schoolDays: [1, 2, 3, 4, 5] };

  test('cycle days count school days only, skipping weekends and closures', () => {
    const cal = new SchoolCalendar(settings, [{ startDate: '2026-11-11', endDate: '2026-11-11' }]);
    const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16'];
    expect(days.map((d) => cal.cycleDay(d))).toEqual([1, 2, null, 1, 2, null, 1]);
    expect(cal.cycleDay('2026-11-06')).toBeNull(); // before the start
  });

  test('a start on a non-school day begins on the next school day', () => {
    const cal = new SchoolCalendar({ ...settings, cycleStartDate: '2026-11-08' }, []); // Sunday
    expect(cal.cycleDay('2026-11-09')).toBe(1);
    expect(cal.cycleDay('2026-11-10')).toBe(2);
  });

  test('cycle day is the same whatever order dates are asked in', () => {
    const a = new SchoolCalendar({ ...settings, cycleLength: 6 }, []);
    const b = new SchoolCalendar({ ...settings, cycleLength: 6 }, []);
    const late = '2027-01-20';
    const first = a.cycleDay(late);
    for (let i = 0; i < 40; i++) b.cycleDay(`2026-12-${String((i % 28) + 1).padStart(2, '0')}`);
    expect(b.cycleDay(late)).toBe(first);
  });

  test('entries follow cycle days', () => {
    const entries = [
      weekly({ id: 'd1', weekday: null, cycleDay: 1 }),
      weekly({ id: 'd2', weekday: null, cycleDay: 2 }),
    ];
    const out = occurrencesBetween(MON, '2026-11-13', { ...base, settings, entries });
    expect(out.map((o) => [o.date, o.entryId, o.cycleDay])).toEqual([
      ['2026-11-09', 'd1', 1],
      ['2026-11-10', 'd2', 2],
      ['2026-11-11', 'd1', 1],
      ['2026-11-12', 'd2', 2],
      ['2026-11-13', 'd1', 1],
    ]);
  });

  test('a cycle-day entry never occurs on a weekly timetable', () => {
    const out = occurrencesBetween(MON, '2026-11-13', {
      ...base,
      entries: [weekly({ weekday: null, cycleDay: 1 })],
    });
    expect(out).toEqual([]);
  });
});

describe('overrides', () => {
  test('cancel keeps the occurrence at its date, marked cancelled', () => {
    const out = occurrencesBetween(MON, MON, {
      ...base,
      entries: [weekly()],
      overrides: [{ entryId: 'e1', occursOn: MON, kind: 'cancel', movedDate: null, movedStart: null, movedEnd: null, movedRoomId: null, note: 'Trip' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'cancelled', note: 'Trip', date: MON });
  });

  test('move to another time and room the same day', () => {
    const out = occurrencesBetween(MON, MON, {
      ...base,
      entries: [weekly()],
      overrides: [{ entryId: 'e1', occursOn: MON, kind: 'move', movedDate: MON, movedStart: 780, movedEnd: 840, movedRoomId: 'r2', note: null }],
    });
    expect(out[0]).toMatchObject({ status: 'moved', startMinute: 780, roomId: 'r2', occursOn: MON });
  });

  test('a move out of the range leaves it; a move in from outside brings it', () => {
    const move = { entryId: 'e1', occursOn: MON, kind: 'move' as const, movedDate: '2026-11-12', movedStart: 600, movedEnd: 660, movedRoomId: null, note: null };
    expect(occurrencesBetween(MON, MON, { ...base, entries: [weekly()], overrides: [move] })).toEqual([]);
    const thursday = occurrencesBetween('2026-11-12', '2026-11-12', { ...base, entries: [weekly()], overrides: [move] });
    expect(thursday).toHaveLength(1);
    expect(thursday[0]).toMatchObject({ date: '2026-11-12', occursOn: MON, roomId: 'r1' });
  });
});

describe('instants', () => {
  test('the same local period start is a different UTC instant across DST', () => {
    const before = occurrenceInstants({ date: '2026-10-23', startMinute: 540, endMinute: 600 }, 'Europe/London');
    const after = occurrenceInstants({ date: '2026-10-26', startMinute: 540, endMinute: 600 }, 'Europe/London');
    expect(before.startsAt.toISOString()).toBe('2026-10-23T08:00:00.000Z');
    expect(after.startsAt.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(after.endsAt.getTime() - after.startsAt.getTime()).toBe(60 * 60_000);
  });
});
