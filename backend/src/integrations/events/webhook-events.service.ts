import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { FeatureService } from '@/features/feature.service';
import type { Prisma } from '@/generated/prisma/client';
import { validateEventData } from '@/integrations/events/webhook-event-types';
import { buildEnvelope } from '@/integrations/events/webhook-envelope';
import { WebhookDeliveryService } from '@/integrations/delivery/webhook-delivery.service';
import { WebhookWorker } from '@/integrations/delivery/webhook.worker';

export interface PersonRef {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}
export interface CourseRef {
  id: string;
  name: string;
  code: string | null;
}
export interface ActivityRef {
  id: string;
  title: string;
  kind: string;
  points: number | null;
}

type EventData = Record<string, unknown>;
/** The event's data, or a function that builds it (only called when someone subscribes). */
type DataSource = EventData | (() => Promise<EventData | null> | EventData | null);

/**
 * Emits webhook events. Owning services call `emit` (or `emitForCourse`)
 * after their change committed; the call returns at once and never throws
 * into the caller. When integrations are off for the school, or no enabled
 * webhook subscribes to the type, it stops after two cheap lookups (the
 * feature map is cached) without building the payload.
 *
 * One delivery row per subscribed webhook is written with the same event id
 * (sent as X-GradeBook-Event-Id) and the same `{ event_type, message, data }`
 * body, `data` led by the school; WebhookDeliveryService sends them.
 */
@Injectable()
export class WebhookEvents {
  private readonly logger = new Logger(WebhookEvents.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
    private readonly deliveries: WebhookDeliveryService,
    private readonly worker: WebhookWorker,
  ) {}

  /**
   * Queue `type` for the school's subscribed webhooks. Resolves once the
   * deliveries are written (or skipped); never rejects. Callers do not
   * await it: `void this.webhooks?.emit(...)`.
   */
  async emit(schoolId: string | null | undefined, type: string, data: DataSource): Promise<number> {
    try {
      if (!schoolId) return 0;
      if (!(await this.features.isEnabled(schoolId, 'integrations'))) return 0;
      const hooks = await this.prisma.school_webhook.findMany({
        where: { school_id: schoolId, enabled: true, events: { has: type } },
        select: { id: true },
      });
      if (hooks.length === 0) return 0;

      const built = typeof data === 'function' ? await data() : data;
      if (!built) return 0;

      const school = await this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
      });
      if (!school) return 0;

      // Every event's data starts with the school (the builders leave it out).
      const full: EventData = { school: { id: school.id, name: school.name ?? '' }, ...built };
      const problems = validateEventData(type, full);
      if (problems.length) {
        this.logger.warn(`Webhook event ${type} does not match its schema: ${problems.slice(0, 5).join('; ')}`);
      }
      const eventId = randomUUID();
      const envelope = buildEnvelope(type, full);
      const rows = await this.prisma.webhook_delivery.createManyAndReturn({
        data: hooks.map((h) => ({
          webhook_id: h.id,
          school_id: schoolId,
          event_id: eventId,
          event_type: type,
          payload: envelope as unknown as Prisma.InputJsonValue,
          status: 'pending',
        })),
        select: { id: true },
      });
      await this.deliveries.schedule(rows.map((r) => r.id));
      this.worker.kick();
      return rows.length;
    } catch (err) {
      this.logger.error(`Failed to queue webhook event ${type} for school ${schoolId}: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * `emit` for something in a course: the course gives the school, and the
   * builder gets the course reference to put in the data.
   */
  async emitForCourse(
    courseId: string,
    type: string,
    build: (course: CourseRef) => Promise<EventData | null> | EventData | null,
  ): Promise<number> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, school_id: true, name: true, code: true },
      });
      if (!course) return 0;
      const ref: CourseRef = { id: course.id, name: course.name, code: course.code };
      return await this.emit(course.school_id, type, () => build(ref));
    } catch (err) {
      this.logger.error(`Failed to queue webhook event ${type} for course ${courseId}: ${(err as Error).message}`);
      return 0;
    }
  }

  // ── references for payloads ───────────────────────────────────────────────

  /** A student by student record id. */
  async student(studentId: string): Promise<PersonRef> {
    const s = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        user_profile: { select: { email: true, app_user: { select: { email: true } } } },
      },
    });
    return {
      id: studentId,
      firstName: s?.first_name ?? null,
      lastName: s?.last_name ?? null,
      email: s?.user_profile?.app_user?.email ?? s?.user_profile?.email ?? null,
    };
  }

  /** The student record of a student account (user profile id), if any. */
  async studentOfUser(userId: string): Promise<PersonRef | null> {
    const s = await this.prisma.student.findFirst({
      where: { user_profile_id: userId },
      select: { id: true },
    });
    return s ? this.student(s.id) : null;
  }

  /** A staff member by user profile id. */
  async staff(userId: string): Promise<PersonRef> {
    const p = await this.prisma.user_profile.findUnique({
      where: { id: userId },
      select: { first_name: true, last_name: true, email: true, app_user: { select: { email: true } } },
    });
    return {
      id: userId,
      firstName: p?.first_name ?? null,
      lastName: p?.last_name ?? null,
      email: p?.app_user?.email ?? p?.email ?? null,
    };
  }

  /** `staff`, or null for no one. */
  async staffOrNull(userId: string | null | undefined): Promise<PersonRef | null> {
    return userId ? this.staff(userId) : null;
  }

  async activity(activityId: string): Promise<ActivityRef | null> {
    const a = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, title: true, kind: true, points: true },
    });
    return a ? toActivityRef(a) : null;
  }
}

export function toActivityRef(a: {
  id: string;
  title: string;
  kind: string;
  points: unknown;
}): ActivityRef {
  return {
    id: a.id,
    title: a.title,
    kind: a.kind,
    points: a.points === null || a.points === undefined ? null : Number(a.points),
  };
}

/** A score column (Decimal or number) as a number, or null. */
export function scoreValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
