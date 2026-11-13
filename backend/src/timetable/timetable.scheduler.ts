import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import { AttendanceService } from '@/attendance/attendance.service';
import { addDays, localParts, toDbDate } from '@/common/time-zone';
import { TimetableService, type TimetableOccurrence } from './timetable.service';
import { withJobLease } from '@/common/job-lease';

const TICK_MS = 60 * 1000;
const FIRST_TICK_MS = 20 * 1000;

export interface TickResult {
  opened: number;
  skipped: number;
}

/**
 * Opens a check-in session for each timetabled period as it starts (minus
 * the school's lead time), with the room's saved location as the geofence
 * point and the period's end as `closes_at`, so the attendance sweep closes
 * it then and records the absentees.
 *
 * Every minute in each API instance; a `job_lease` claim lets one
 * instance run at a time (like the parent notice and retention sweeps), so
 * it needs no Redis. Each occurrence (entry + scheduled date) is claimed
 * with an insert into `course.timetable_occurrence` before its session is
 * opened, so it is opened at most once whatever happens: a retry, two
 * instances, or staff deleting the session afterwards. Nothing runs under
 * NODE_ENV=test or with TIMETABLE_SCHEDULER=false. A school whose time zone
 * is not set yet is skipped (and logged once per boot).
 */
@Injectable()
export class TimetableScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TimetableScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private firstRun?: ReturnType<typeof setTimeout>;
  private running = false;
  /** Schools already logged as skipped for having no time zone (once per boot). */
  private readonly noZoneLogged = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly timetable: TimetableService,
    private readonly attendance: AttendanceService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.TIMETABLE_SCHEDULER === 'false') return;
    this.firstRun = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  async tick(now = new Date()): Promise<TickResult> {
    const result: TickResult = { opened: 0, skipped: 0 };
    if (this.running) return result;
    this.running = true;
    try {
      await withJobLease(this.prisma, 'gradebook:timetable', 5 * 60_000, async () => {
        const r = await this.run(now);
        result.opened = r.opened;
        result.skipped = r.skipped;
      });
      if (result.opened > 0) this.logger.log(`Opened ${result.opened} timetabled sessions`);
    } catch (err) {
      this.logger.error(`Timetable tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return result;
  }

  /** One pass over every school with timetabled published courses. */
  async run(now: Date): Promise<TickResult> {
    const result: TickResult = { opened: 0, skipped: 0 };
    const courses = await this.prisma.course.findMany({
      where: { status: 'published', is_template: false, timetable_entry: { some: {} } },
      select: { id: true, school_id: true },
    });
    const bySchool = new Map<string, string[]>();
    for (const c of courses) {
      const list = bySchool.get(c.school_id) ?? [];
      list.push(c.id);
      bySchool.set(c.school_id, list);
    }

    for (const [schoolId, courseIds] of bySchool) {
      try {
        if (!(await this.features.isEnabled(schoolId, 'timetable'))) continue;
        const ctx = await this.timetable.context(schoolId);
        if (!ctx.settings.autoSessions) continue;
        // No zone set: local period times cannot be placed, so nothing opens.
        if (!ctx.settings.timeZoneSet) {
          if (!this.noZoneLogged.has(schoolId)) {
            this.noZoneLogged.add(schoolId);
            this.logger.warn(
              `School ${schoolId} has no time zone set; skipping its automatic sessions until an admin sets one`,
            );
          }
          continue;
        }
        const today = localParts(now, ctx.settings.timeZone).date;
        // Yesterday too: a lead time can open a period just after midnight
        // UTC on the local day before; anything ended is filtered below.
        const due = (
          await this.timetable.occurrencesFor(ctx, courseIds, addDays(today, -1), today, {
            withSessions: false,
          })
        ).filter((o) => this.isDue(o, now, ctx.settings.leadMinutes));
        for (const o of due) {
          const r = await this.openOccurrence(o, ctx, now);
          if (r === 'opened') result.opened++;
          else if (r === 'skipped') result.skipped++;
        }
      } catch (err) {
        this.logger.error(`Timetable for school ${schoolId} failed: ${(err as Error).message}`);
      }
    }
    return result;
  }

  isDue(o: TimetableOccurrence, now: Date, leadMinutes: number): boolean {
    if (o.status === 'cancelled') return false;
    const opensAt = Date.parse(o.startsAt) - leadMinutes * 60_000;
    return now.getTime() >= opensAt && now.getTime() < Date.parse(o.endsAt);
  }

  /** Claim the occurrence, then open its session. Returns what happened. */
  async openOccurrence(
    o: TimetableOccurrence,
    ctx: Awaited<ReturnType<TimetableService['context']>>,
    now: Date,
  ): Promise<'opened' | 'skipped' | 'taken'> {
    const claim = await this.prisma.timetable_occurrence.createManyAndReturn({
      data: [{ entry_id: o.entryId, occurs_on: toDbDate(o.occursOn), status: 'opened' }],
      skipDuplicates: true,
      select: { entry_id: true },
    });
    if (claim.length === 0) return 'taken';

    const room = o.roomId ? ctx.rooms.get(o.roomId) : undefined;
    const startsAt = Date.parse(o.startsAt);
    // Late is measured from the period's start, whenever the session opened.
    const lateAfter =
      ctx.settings.lateAfterMinutes === null
        ? null
        : Math.max(
            0,
            Math.ceil((startsAt + ctx.settings.lateAfterMinutes * 60_000 - now.getTime()) / 60_000),
          );
    const where = { entry_id: o.entryId, occurs_on: toDbDate(o.occursOn) };
    try {
      const session = await this.attendance.openScheduled(o.courseId, {
        title: [o.periodName, room?.name].filter(Boolean).join(' · ') || null,
        requireCode: ctx.settings.requireCode,
        lateAfterMinutes: lateAfter,
        location: room?.location ?? null,
        openedAt: now,
        closesAt: new Date(o.endsAt),
      });
      await this.prisma.timetable_occurrence.updateMany({
        where,
        data: { session_id: session.id },
      });
      return 'opened';
    } catch (err) {
      await this.prisma.timetable_occurrence
        .updateMany({
          where,
          data: { status: 'skipped', reason: (err as Error).message.slice(0, 200) },
        })
        .catch(() => {});
      return 'skipped';
    }
  }
}
