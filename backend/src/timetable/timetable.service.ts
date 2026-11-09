import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { isUniqueViolation } from '@/common/db-values';
import { userSchoolId } from '@/common/user-school';
import {
  addDays,
  dateOnly,
  daysBetween,
  isIsoDate,
  isValidTimeZone,
  isoWeekday,
  localParts,
  safeTimeZone,
  toDbDate,
} from '@/common/time-zone';
import {
  CourseAccessService,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import {
  occurrenceInstants,
  occurrencesBetween,
  SchoolCalendar,
  type Closure,
  type CycleSettings,
  type EntryInput,
  type Occurrence,
  type OverrideInput,
  type PeriodTimes,
} from './occurrences';
import type {
  ClosureDto,
  OccurrenceOverrideDto,
  PeriodDto,
  RoomDto,
  TimetableEntryDto,
  UpdateTimetableSettingsDto,
} from './dto/timetable.dto';

/** The longest range a timetable read may cover. */
export const MAX_RANGE_DAYS = 62;
export const DEFAULT_ROOM_RADIUS_M = 50;

export interface TimetableSettings {
  timeZone: string;
  cycleLength: number | null;
  cycleStartDate: string | null;
  schoolDays: number[];
  autoSessions: boolean;
  leadMinutes: number;
  lateAfterMinutes: number | null;
  requireCode: boolean;
}

export interface Room {
  id: string;
  name: string;
  location: { latitude: number; longitude: number; radiusM: number } | null;
}

export interface Period {
  id: string;
  name: string;
  position: number;
  times: { weekday: number; startMinute: number; endMinute: number }[];
}

export interface SchoolClosure {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface TimetableEntry {
  id: string;
  courseId: string;
  periodId: string;
  periodName: string;
  roomId: string | null;
  roomName: string | null;
  weekday: number | null;
  cycleDay: number | null;
  validFrom: string | null;
  validTo: string | null;
}

/** One occurrence as the API sends it. */
export interface TimetableOccurrence {
  entryId: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
  periodId: string;
  periodName: string;
  occursOn: string;
  date: string;
  startMinute: number;
  endMinute: number;
  startsAt: string;
  endsAt: string;
  roomId: string | null;
  roomName: string | null;
  status: Occurrence['status'];
  note: string | null;
  cycleDay: number | null;
  /** Staff only: the automatic session, when the scheduler opened one. */
  session?: { id: string | null; state: 'opened' | 'skipped'; reason: string | null } | null;
}

export const DEFAULT_SETTINGS: Omit<TimetableSettings, 'timeZone'> = {
  cycleLength: null,
  cycleStartDate: null,
  schoolDays: [1, 2, 3, 4, 5],
  autoSessions: true,
  leadMinutes: 0,
  lateAfterMinutes: null,
  requireCode: true,
};

/** Everything about a school the occurrence maths needs. */
export interface SchoolContext {
  schoolId: string;
  settings: TimetableSettings;
  closures: Closure[];
  periods: Map<string, PeriodTimes>;
  rooms: Map<string, Room>;
}

const toRoom = (r: {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number | null;
}): Room => ({
  id: r.id,
  name: r.name,
  location:
    r.latitude !== null && r.longitude !== null && r.radius_m !== null
      ? { latitude: r.latitude, longitude: r.longitude, radiusM: r.radius_m }
      : null,
});

/**
 * Timetables: the school's rooms, bell schedule, closures and cycle, each
 * course's entries and per-occurrence overrides, and the dated views built
 * from them (a course, a member of staff's day, a student's week).
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
  ) {}

  // ── school context ───────────────────────────────────────────────────────

  async schoolOf(userId: string): Promise<string> {
    const schoolId = await userSchoolId(this.prisma, userId);
    if (!schoolId) throw new BadRequestException('You are not assigned to a school');
    return schoolId;
  }

  async context(schoolId: string): Promise<SchoolContext> {
    const [school, setting, closures, periods, rooms] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { time_zone: true } }),
      this.prisma.timetable_setting.findUnique({ where: { school_id: schoolId } }),
      this.prisma.school_closure.findMany({
        where: { school_id: schoolId },
        orderBy: { start_date: 'asc' },
        select: { start_date: true, end_date: true },
      }),
      this.prisma.bell_period.findMany({
        where: { school_id: schoolId },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, position: true, bell_period_time: true },
      }),
      this.prisma.room.findMany({
        where: { school_id: schoolId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, latitude: true, longitude: true, radius_m: true },
      }),
    ]);
    if (!school) throw new NotFoundException('School not found');
    return {
      schoolId,
      settings: {
        timeZone: safeTimeZone(school.time_zone),
        cycleLength: setting?.cycle_length ?? DEFAULT_SETTINGS.cycleLength,
        cycleStartDate: dateOnly(setting?.cycle_start_date) ?? DEFAULT_SETTINGS.cycleStartDate,
        schoolDays: setting?.school_days ?? DEFAULT_SETTINGS.schoolDays,
        autoSessions: setting?.auto_sessions ?? DEFAULT_SETTINGS.autoSessions,
        leadMinutes: setting?.lead_minutes ?? DEFAULT_SETTINGS.leadMinutes,
        lateAfterMinutes: setting ? setting.late_after_minutes : DEFAULT_SETTINGS.lateAfterMinutes,
        requireCode: setting?.require_code ?? DEFAULT_SETTINGS.requireCode,
      },
      closures: closures.map((c) => ({
        startDate: dateOnly(c.start_date)!,
        endDate: dateOnly(c.end_date)!,
      })),
      periods: new Map(
        periods.map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            position: p.position,
            times: new Map(
              p.bell_period_time.map((t) => [t.weekday, { start: t.start_minute, end: t.end_minute }]),
            ),
          },
        ]),
      ),
      rooms: new Map(rooms.map((r) => [r.id, toRoom(r)])),
    };
  }

  private cycleSettings(ctx: SchoolContext): CycleSettings {
    return {
      cycleLength: ctx.settings.cycleLength,
      cycleStartDate: ctx.settings.cycleStartDate,
      schoolDays: ctx.settings.schoolDays,
    };
  }

  /** The school's setup, for the admin pages and the course editor. */
  async setup(schoolId: string) {
    const ctx = await this.context(schoolId);
    const closures = await this.prisma.school_closure.findMany({
      where: { school_id: schoolId },
      orderBy: { start_date: 'asc' },
      select: { id: true, name: true, start_date: true, end_date: true },
    });
    return {
      settings: ctx.settings,
      rooms: [...ctx.rooms.values()],
      periods: this.periodList(ctx),
      closures: closures.map(
        (c): SchoolClosure => ({
          id: c.id,
          name: c.name,
          startDate: dateOnly(c.start_date)!,
          endDate: dateOnly(c.end_date)!,
        }),
      ),
      today: localParts(new Date(), ctx.settings.timeZone).date,
    };
  }

  private periodList(ctx: SchoolContext): Period[] {
    return [...ctx.periods.values()].map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      times: [...p.times.entries()]
        .map(([weekday, t]) => ({ weekday, startMinute: t.start, endMinute: t.end }))
        .sort((a, b) => a.weekday - b.weekday),
    }));
  }

  async updateSettings(userId: string, schoolId: string, dto: UpdateTimetableSettingsDto) {
    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      throw new BadRequestException('Unknown time zone');
    }
    if (dto.cycleStartDate && !isIsoDate(dto.cycleStartDate)) {
      throw new BadRequestException('cycleStartDate is not a real date');
    }
    const current = await this.context(schoolId);
    const cycleLength = dto.cycleLength !== undefined ? dto.cycleLength : current.settings.cycleLength;
    const cycleStart =
      dto.cycleStartDate !== undefined ? dto.cycleStartDate : current.settings.cycleStartDate;
    if (cycleLength !== null && !cycleStart) {
      throw new BadRequestException('A rotating timetable needs the date of cycle day 1');
    }
    if (dto.schoolDays && dto.schoolDays.length === 0) {
      throw new BadRequestException('Choose at least one school day');
    }

    if (dto.timeZone !== undefined) {
      await this.prisma.school.update({ where: { id: schoolId }, data: { time_zone: dto.timeZone } });
    }
    const data = {
      cycle_length: cycleLength,
      cycle_start_date: cycleLength !== null && cycleStart ? toDbDate(cycleStart) : null,
      ...(dto.schoolDays ? { school_days: [...dto.schoolDays].sort() } : {}),
      ...(dto.autoSessions !== undefined ? { auto_sessions: dto.autoSessions } : {}),
      ...(dto.leadMinutes !== undefined ? { lead_minutes: dto.leadMinutes } : {}),
      ...(dto.lateAfterMinutes !== undefined ? { late_after_minutes: dto.lateAfterMinutes } : {}),
      ...(dto.requireCode !== undefined ? { require_code: dto.requireCode } : {}),
      updated_by: userId,
      updated_at: new Date(),
    };
    await this.prisma.timetable_setting.upsert({
      where: { school_id: schoolId },
      create: { school_id: schoolId, ...data },
      update: data,
    });
    return (await this.context(schoolId)).settings;
  }

  // ── rooms ────────────────────────────────────────────────────────────────

  async createRoom(schoolId: string, dto: RoomDto): Promise<Room> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Give the room a name');
    try {
      const row = await this.prisma.room.create({
        data: { school_id: schoolId, name, ...this.locationData(dto.location ?? null) },
      });
      return toRoom(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A room with that name already exists');
      throw err;
    }
  }

  async updateRoom(schoolId: string, roomId: string, dto: RoomDto): Promise<Room> {
    await this.ownRoom(schoolId, roomId);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Give the room a name');
    try {
      const row = await this.prisma.room.update({
        where: { id: roomId },
        data: {
          ...(name ? { name } : {}),
          ...(dto.location !== undefined ? this.locationData(dto.location) : {}),
          updated_at: new Date(),
        },
      });
      return toRoom(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A room with that name already exists');
      throw err;
    }
  }

  async deleteRoom(schoolId: string, roomId: string) {
    await this.ownRoom(schoolId, roomId);
    await this.prisma.room.delete({ where: { id: roomId } });
  }

  private locationData(loc: RoomDto['location'] | null) {
    return loc
      ? { latitude: loc.latitude, longitude: loc.longitude, radius_m: loc.radiusM ?? DEFAULT_ROOM_RADIUS_M }
      : { latitude: null, longitude: null, radius_m: null };
  }

  private async ownRoom(schoolId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, school_id: schoolId },
      select: { id: true },
    });
    if (!room) throw new NotFoundException('Room not found');
  }

  // ── bell schedule ────────────────────────────────────────────────────────

  private checkTimes(times: PeriodDto['times']) {
    if (!times) return;
    const days = new Set<number>();
    for (const t of times) {
      if (t.endMinute <= t.startMinute) {
        throw new BadRequestException('A period must end after it starts');
      }
      if (days.has(t.weekday)) throw new BadRequestException('One time per weekday');
      days.add(t.weekday);
    }
  }

  async createPeriod(schoolId: string, dto: PeriodDto): Promise<Period> {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Give the period a name');
    this.checkTimes(dto.times);
    try {
      const row = await this.prisma.bell_period.create({
        data: {
          school_id: schoolId,
          name,
          position: dto.position ?? 0,
          bell_period_time: {
            create: (dto.times ?? []).map((t) => ({
              weekday: t.weekday,
              start_minute: t.startMinute,
              end_minute: t.endMinute,
            })),
          },
        },
        select: { id: true },
      });
      return this.onePeriod(schoolId, row.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A period with that name already exists');
      throw err;
    }
  }

  async updatePeriod(schoolId: string, periodId: string, dto: PeriodDto): Promise<Period> {
    await this.ownPeriod(schoolId, periodId);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Give the period a name');
    this.checkTimes(dto.times);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.bell_period.update({
          where: { id: periodId },
          data: {
            ...(name ? { name } : {}),
            ...(dto.position !== undefined ? { position: dto.position } : {}),
          },
        });
        if (dto.times) {
          await tx.bell_period_time.deleteMany({ where: { period_id: periodId } });
          await tx.bell_period_time.createMany({
            data: dto.times.map((t) => ({
              period_id: periodId,
              weekday: t.weekday,
              start_minute: t.startMinute,
              end_minute: t.endMinute,
            })),
          });
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A period with that name already exists');
      throw err;
    }
    return this.onePeriod(schoolId, periodId);
  }

  /** Deleting a period deletes the timetable entries in it. */
  async deletePeriod(schoolId: string, periodId: string) {
    await this.ownPeriod(schoolId, periodId);
    await this.prisma.bell_period.delete({ where: { id: periodId } });
  }

  private async onePeriod(schoolId: string, periodId: string): Promise<Period> {
    const ctx = await this.context(schoolId);
    const p = this.periodList(ctx).find((x) => x.id === periodId);
    if (!p) throw new NotFoundException('Period not found');
    return p;
  }

  private async ownPeriod(schoolId: string, periodId: string) {
    const p = await this.prisma.bell_period.findFirst({
      where: { id: periodId, school_id: schoolId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Period not found');
  }

  // ── closures ─────────────────────────────────────────────────────────────

  async createClosure(userId: string, schoolId: string, dto: ClosureDto): Promise<SchoolClosure> {
    if (!isIsoDate(dto.startDate) || !isIsoDate(dto.endDate)) {
      throw new BadRequestException('Use real dates');
    }
    if (dto.endDate < dto.startDate) throw new BadRequestException('The end is before the start');
    if (daysBetween(dto.startDate, dto.endDate) > 366) {
      throw new BadRequestException('A closure can be at most a year long');
    }
    const row = await this.prisma.school_closure.create({
      data: {
        school_id: schoolId,
        name: dto.name.trim(),
        start_date: toDbDate(dto.startDate),
        end_date: toDbDate(dto.endDate),
        created_by: userId,
      },
    });
    return {
      id: row.id,
      name: row.name,
      startDate: dateOnly(row.start_date)!,
      endDate: dateOnly(row.end_date)!,
    };
  }

  async deleteClosure(schoolId: string, closureId: string) {
    const { count } = await this.prisma.school_closure.deleteMany({
      where: { id: closureId, school_id: schoolId },
    });
    if (count === 0) throw new NotFoundException('Closure not found');
  }

  /** Cycle days and closures over a range, to check the rotation. */
  async cyclePreview(schoolId: string, from?: string, to?: string) {
    const ctx = await this.context(schoolId);
    const range = this.range(ctx, from, to, 27);
    const cal = new SchoolCalendar(this.cycleSettings(ctx), ctx.closures);
    const days: { date: string; weekday: number; schoolDay: boolean; closed: boolean; cycleDay: number | null }[] = [];
    for (let i = 0; i <= daysBetween(range.from, range.to); i++) {
      const date = addDays(range.from, i);
      days.push({
        date,
        weekday: isoWeekday(date),
        schoolDay: cal.isSchoolDay(date),
        closed: cal.isClosed(date),
        cycleDay: cal.cycleDay(date),
      });
    }
    return { ...range, days };
  }

  // ── ranges ───────────────────────────────────────────────────────────────

  /** A validated [from, to] of local days; defaults to today + `span` days. */
  range(ctx: SchoolContext, from?: string, to?: string, span = 0) {
    for (const d of [from, to]) {
      if (d !== undefined && !isIsoDate(d)) throw new BadRequestException('Use real dates (YYYY-MM-DD)');
    }
    const today = localParts(new Date(), ctx.settings.timeZone).date;
    const f = from ?? today;
    const t = to ?? addDays(f, span);
    const days = daysBetween(f, t);
    if (days < 0) throw new BadRequestException('`to` is before `from`');
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(`A range can cover at most ${MAX_RANGE_DAYS} days`);
    }
    return { from: f, to: t, today };
  }

  // ── entries ──────────────────────────────────────────────────────────────

  private async entryRows(courseIds: string[]) {
    if (courseIds.length === 0) return [];
    return this.prisma.timetable_entry.findMany({
      where: { course_id: { in: courseIds } },
      select: {
        id: true,
        course_id: true,
        period_id: true,
        room_id: true,
        weekday: true,
        cycle_day: true,
        valid_from: true,
        valid_to: true,
        course: {
          select: {
            name: true,
            code: true,
            term: { select: { start_date: true, end_date: true } },
          },
        },
      },
    });
  }

  private toEntryInput(e: Awaited<ReturnType<TimetableService['entryRows']>>[number]): EntryInput {
    return {
      id: e.id,
      courseId: e.course_id,
      periodId: e.period_id,
      roomId: e.room_id,
      weekday: e.weekday,
      cycleDay: e.cycle_day,
      from: dateOnly(e.valid_from) ?? dateOnly(e.course.term?.start_date ?? null),
      to: dateOnly(e.valid_to) ?? dateOnly(e.course.term?.end_date ?? null),
    };
  }

  private toEntry(
    ctx: SchoolContext,
    e: Awaited<ReturnType<TimetableService['entryRows']>>[number],
  ): TimetableEntry {
    return {
      id: e.id,
      courseId: e.course_id,
      periodId: e.period_id,
      periodName: ctx.periods.get(e.period_id)?.name ?? '',
      roomId: e.room_id,
      roomName: e.room_id ? (ctx.rooms.get(e.room_id)?.name ?? null) : null,
      weekday: e.weekday,
      cycleDay: e.cycle_day,
      validFrom: dateOnly(e.valid_from),
      validTo: dateOnly(e.valid_to),
    };
  }

  /** The course's entries and what the editor needs to add more. */
  async courseTimetable(userId: string, courseId: string) {
    const { course, role } = await this.access.require(userId, courseId, STAFF_ROLES);
    const ctx = await this.context(course.school_id);
    const [rows, term] = await Promise.all([
      this.entryRows([courseId]),
      course.term_id
        ? this.prisma.term.findUnique({
            where: { id: course.term_id },
            select: { name: true, start_date: true, end_date: true },
          })
        : null,
    ]);
    const order = (e: TimetableEntry) =>
      (e.weekday ?? e.cycleDay ?? 0) * 1000 + (ctx.periods.get(e.periodId)?.position ?? 0);
    return {
      canEdit: MANAGE_ROLES.includes(role),
      entries: rows.map((e) => this.toEntry(ctx, e)).sort((a, b) => order(a) - order(b)),
      settings: ctx.settings,
      periods: this.periodList(ctx),
      rooms: [...ctx.rooms.values()],
      term: term
        ? { name: term.name, startDate: dateOnly(term.start_date), endDate: dateOnly(term.end_date) }
        : null,
    };
  }

  private async validateEntry(
    ctx: SchoolContext,
    course: { term_id: string | null },
    next: {
      periodId: string;
      roomId: string | null;
      weekday: number | null;
      cycleDay: number | null;
      validFrom: string | null;
      validTo: string | null;
    },
  ) {
    if (!ctx.periods.has(next.periodId)) throw new BadRequestException('Unknown period');
    if (next.roomId && !ctx.rooms.has(next.roomId)) throw new BadRequestException('Unknown room');
    if ((next.weekday === null) === (next.cycleDay === null)) {
      throw new BadRequestException('Give either a weekday or a cycle day');
    }
    if (next.cycleDay !== null) {
      if (!ctx.settings.cycleLength) {
        throw new BadRequestException('The school timetable is weekly; choose a weekday');
      }
      if (next.cycleDay > ctx.settings.cycleLength) {
        throw new BadRequestException(`The cycle has ${ctx.settings.cycleLength} days`);
      }
    }
    for (const d of [next.validFrom, next.validTo]) {
      if (d && !isIsoDate(d)) throw new BadRequestException('Use real dates (YYYY-MM-DD)');
    }
    if (next.validFrom && next.validTo && next.validTo < next.validFrom) {
      throw new BadRequestException('validTo is before validFrom');
    }
    if (course.term_id && (next.validFrom || next.validTo)) {
      const term = await this.prisma.term.findUnique({
        where: { id: course.term_id },
        select: { start_date: true, end_date: true },
      });
      const start = dateOnly(term?.start_date ?? null);
      const end = dateOnly(term?.end_date ?? null);
      const outside = (d: string | null) => !!d && ((start && d < start) || (end && d > end));
      if (outside(next.validFrom) || outside(next.validTo)) {
        throw new BadRequestException("The dates must be within the course's term");
      }
    }
  }

  async createEntry(userId: string, courseId: string, dto: TimetableEntryDto): Promise<TimetableEntry> {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const ctx = await this.context(course.school_id);
    if (!dto.periodId) throw new BadRequestException('Choose a period');
    const next = {
      periodId: dto.periodId,
      roomId: dto.roomId ?? null,
      weekday: dto.weekday ?? null,
      cycleDay: dto.cycleDay ?? null,
      validFrom: dto.validFrom ?? null,
      validTo: dto.validTo ?? null,
    };
    await this.validateEntry(ctx, course, next);
    const row = await this.prisma.timetable_entry.create({
      data: {
        course_id: courseId,
        period_id: next.periodId,
        room_id: next.roomId,
        weekday: next.weekday,
        cycle_day: next.cycleDay,
        valid_from: next.validFrom ? toDbDate(next.validFrom) : null,
        valid_to: next.validTo ? toDbDate(next.validTo) : null,
        created_by: userId,
      },
      select: { id: true },
    });
    return this.oneEntry(ctx, courseId, row.id);
  }

  async updateEntry(
    userId: string,
    courseId: string,
    entryId: string,
    dto: TimetableEntryDto,
  ): Promise<TimetableEntry> {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    const ctx = await this.context(course.school_id);
    const current = await this.prisma.timetable_entry.findFirst({
      where: { id: entryId, course_id: courseId },
    });
    if (!current) throw new NotFoundException('Timetable entry not found');
    // Switching weekday ↔ cycle day: giving one clears the other.
    const weekday =
      dto.weekday !== undefined ? dto.weekday : dto.cycleDay != null ? null : current.weekday;
    const cycleDay =
      dto.cycleDay !== undefined ? dto.cycleDay : dto.weekday != null ? null : current.cycle_day;
    const next = {
      periodId: dto.periodId ?? current.period_id,
      roomId: dto.roomId !== undefined ? dto.roomId : current.room_id,
      weekday,
      cycleDay,
      validFrom: dto.validFrom !== undefined ? dto.validFrom : dateOnly(current.valid_from),
      validTo: dto.validTo !== undefined ? dto.validTo : dateOnly(current.valid_to),
    };
    await this.validateEntry(ctx, course, next);
    await this.prisma.timetable_entry.update({
      where: { id: entryId },
      data: {
        period_id: next.periodId,
        room_id: next.roomId,
        weekday: next.weekday,
        cycle_day: next.cycleDay,
        valid_from: next.validFrom ? toDbDate(next.validFrom) : null,
        valid_to: next.validTo ? toDbDate(next.validTo) : null,
        updated_at: new Date(),
      },
    });
    return this.oneEntry(ctx, courseId, entryId);
  }

  async deleteEntry(userId: string, courseId: string, entryId: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    const { count } = await this.prisma.timetable_entry.deleteMany({
      where: { id: entryId, course_id: courseId },
    });
    if (count === 0) throw new NotFoundException('Timetable entry not found');
  }

  private async oneEntry(ctx: SchoolContext, courseId: string, entryId: string) {
    const [row] = (await this.entryRows([courseId])).filter((e) => e.id === entryId);
    if (!row) throw new NotFoundException('Timetable entry not found');
    return this.toEntry(ctx, row);
  }

  // ── occurrences ──────────────────────────────────────────────────────────

  /** Occurrences of these courses' entries in [from, to], shaped for the API. */
  async occurrencesFor(
    ctx: SchoolContext,
    courseIds: string[],
    from: string,
    to: string,
    opts: { withSessions: boolean },
  ): Promise<TimetableOccurrence[]> {
    const rows = await this.entryRows(courseIds);
    if (rows.length === 0) return [];
    const entryIds = rows.map((r) => r.id);
    const overrides = await this.prisma.timetable_override.findMany({
      where: {
        entry_id: { in: entryIds },
        OR: [
          { occurs_on: { gte: toDbDate(from), lte: toDbDate(to) } },
          { moved_date: { gte: toDbDate(from), lte: toDbDate(to) } },
        ],
      },
    });
    const occurrences = occurrencesBetween(from, to, {
      settings: this.cycleSettings(ctx),
      closures: ctx.closures,
      periods: ctx.periods,
      entries: rows.map((r) => this.toEntryInput(r)),
      overrides: overrides.map(
        (o): OverrideInput => ({
          entryId: o.entry_id,
          occursOn: dateOnly(o.occurs_on)!,
          kind: o.kind === 'move' ? 'move' : 'cancel',
          movedDate: dateOnly(o.moved_date),
          movedStart: o.moved_start_minute,
          movedEnd: o.moved_end_minute,
          movedRoomId: o.moved_room_id,
          note: o.note,
        }),
      ),
    });

    let claimed = new Map<string, { session_id: string | null; status: string; reason: string | null }>();
    if (opts.withSessions && occurrences.length > 0) {
      const dates = [...new Set(occurrences.map((o) => o.occursOn))];
      const claims = await this.prisma.timetable_occurrence.findMany({
        where: { entry_id: { in: entryIds }, occurs_on: { in: dates.map(toDbDate) } },
        select: { entry_id: true, occurs_on: true, session_id: true, status: true, reason: true },
      });
      claimed = new Map(claims.map((c) => [`${c.entry_id}|${dateOnly(c.occurs_on)}`, c]));
    }

    const courseOf = new Map(rows.map((r) => [r.course_id, r.course]));
    return occurrences.map((o) => {
      const { startsAt, endsAt } = occurrenceInstants(o, ctx.settings.timeZone);
      const c = courseOf.get(o.courseId);
      const claim = claimed.get(`${o.entryId}|${o.occursOn}`);
      return {
        entryId: o.entryId,
        courseId: o.courseId,
        courseName: c?.name ?? '',
        courseCode: c?.code ?? null,
        periodId: o.periodId,
        periodName: ctx.periods.get(o.periodId)?.name ?? '',
        occursOn: o.occursOn,
        date: o.date,
        startMinute: o.startMinute,
        endMinute: o.endMinute,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        roomId: o.roomId,
        roomName: o.roomId ? (ctx.rooms.get(o.roomId)?.name ?? null) : null,
        status: o.status,
        note: o.note,
        cycleDay: o.cycleDay,
        ...(opts.withSessions
          ? {
              session: claim
                ? {
                    id: claim.session_id,
                    state: claim.status === 'opened' ? ('opened' as const) : ('skipped' as const),
                    reason: claim.reason,
                  }
                : null,
            }
          : {}),
      };
    });
  }

  async courseOccurrences(userId: string, courseId: string, from?: string, to?: string) {
    const { course } = await this.access.require(userId, courseId, STAFF_ROLES);
    const ctx = await this.context(course.school_id);
    const range = this.range(ctx, from, to, 6);
    return {
      ...range,
      occurrences: await this.occurrencesFor(ctx, [courseId], range.from, range.to, {
        withSessions: true,
      }),
    };
  }

  /** A member of staff's own periods (courses they teach or assist) in their active school. */
  async myOccurrences(userId: string, from?: string, to?: string) {
    const schoolId = await this.schoolOf(userId);
    const ctx = await this.context(schoolId);
    const range = this.range(ctx, from, to, 0);
    const staffed = await this.prisma.course_staff.findMany({
      where: {
        user_profile_id: userId,
        course: { school_id: schoolId, is_template: false, status: { in: ['draft', 'published'] } },
      },
      select: { course_id: true },
    });
    return {
      ...range,
      timeZone: ctx.settings.timeZone,
      occurrences: await this.occurrencesFor(
        ctx,
        staffed.map((s) => s.course_id),
        range.from,
        range.to,
        { withSessions: true },
      ),
    };
  }

  /** A student's timetable: active enrolments in published courses. */
  async studentOccurrences(studentId: string, schoolId: string, from?: string, to?: string) {
    const ctx = await this.context(schoolId);
    let f = from;
    let t = to;
    if (!f && !t) {
      // Default: this week, Monday to Sunday.
      const today = localParts(new Date(), ctx.settings.timeZone).date;
      f = addDays(today, 1 - isoWeekday(today));
      t = addDays(f, 6);
    }
    const range = this.range(ctx, f, t, 6);
    const enrolled = await this.prisma.course_student.findMany({
      where: {
        student_id: studentId,
        status: 'active',
        course: { status: 'published', is_template: false, school_id: schoolId },
      },
      select: { course_id: true },
    });
    return {
      ...range,
      timeZone: ctx.settings.timeZone,
      occurrences: await this.occurrencesFor(
        ctx,
        enrolled.map((e) => e.course_id),
        range.from,
        range.to,
        { withSessions: false },
      ),
    };
  }

  /**
   * Cancel or move one occurrence (the entry on its scheduled date). Refused
   * once the scheduler has handled it: close or delete that session instead.
   */
  async setOverride(
    userId: string,
    courseId: string,
    entryId: string,
    occursOn: string,
    dto: OccurrenceOverrideDto,
  ) {
    const { course } = await this.access.require(userId, courseId, MANAGE_ROLES);
    if (!isIsoDate(occursOn)) throw new BadRequestException('Use a real date (YYYY-MM-DD)');
    const ctx = await this.context(course.school_id);
    const entry = await this.prisma.timetable_entry.findFirst({
      where: { id: entryId, course_id: courseId },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Timetable entry not found');

    // It must be a real occurrence of the entry on that day.
    const [scheduled] = (
      await this.occurrencesFor(ctx, [courseId], occursOn, occursOn, { withSessions: false })
    ).filter((o) => o.entryId === entryId && o.occursOn === occursOn);
    const existingOverride = await this.prisma.timetable_override.findUnique({
      where: { entry_id_occurs_on: { entry_id: entryId, occurs_on: toDbDate(occursOn) } },
      select: { id: true },
    });
    if (!scheduled && !existingOverride) {
      throw new NotFoundException('This period does not happen on that day');
    }
    const claimed = await this.prisma.timetable_occurrence.findUnique({
      where: { entry_id_occurs_on: { entry_id: entryId, occurs_on: toDbDate(occursOn) } },
      select: { status: true },
    });
    if (claimed) {
      throw new ConflictException('Attendance for this period has already opened');
    }

    let data;
    if (dto.kind === 'cancel') {
      data = {
        kind: 'cancel',
        moved_date: null,
        moved_start_minute: null,
        moved_end_minute: null,
        moved_room_id: null,
      };
    } else {
      const date = dto.date ?? occursOn;
      if (!isIsoDate(date)) throw new BadRequestException('Use a real date (YYYY-MM-DD)');
      const base = scheduled ?? null;
      const start = dto.startMinute ?? base?.startMinute;
      const end = dto.endMinute ?? base?.endMinute;
      if (start === undefined || end === undefined) {
        throw new BadRequestException('Give the new start and end times');
      }
      if (end <= start) throw new BadRequestException('The period must end after it starts');
      if (Math.abs(daysBetween(occursOn, date)) > 31) {
        throw new BadRequestException('Move a period by at most a month');
      }
      if (dto.roomId && !ctx.rooms.has(dto.roomId)) throw new BadRequestException('Unknown room');
      data = {
        kind: 'move',
        moved_date: toDbDate(date),
        moved_start_minute: start,
        moved_end_minute: end,
        moved_room_id: dto.roomId ?? null,
      };
    }
    await this.prisma.timetable_override.upsert({
      where: { entry_id_occurs_on: { entry_id: entryId, occurs_on: toDbDate(occursOn) } },
      create: {
        entry_id: entryId,
        occurs_on: toDbDate(occursOn),
        ...data,
        note: dto.note?.trim() || null,
        created_by: userId,
      },
      update: { ...data, note: dto.note?.trim() || null, updated_at: new Date() },
    });
    return this.courseOccurrences(userId, courseId, occursOn, occursOn);
  }

  /** Undo a cancel or move. */
  async clearOverride(userId: string, courseId: string, entryId: string, occursOn: string) {
    await this.access.require(userId, courseId, MANAGE_ROLES);
    if (!isIsoDate(occursOn)) throw new BadRequestException('Use a real date (YYYY-MM-DD)');
    const entry = await this.prisma.timetable_entry.findFirst({
      where: { id: entryId, course_id: courseId },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException('Timetable entry not found');
    const claimed = await this.prisma.timetable_occurrence.findUnique({
      where: { entry_id_occurs_on: { entry_id: entryId, occurs_on: toDbDate(occursOn) } },
      select: { status: true },
    });
    if (claimed) throw new ConflictException('Attendance for this period has already opened');
    await this.prisma.timetable_override.deleteMany({
      where: { entry_id: entryId, occurs_on: toDbDate(occursOn) },
    });
  }
}
