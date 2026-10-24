import { Injectable } from '@nestjs/common';
import { RedisPubSubService } from '@/realtime/redis-pubsub.service';
import type {
  AttendanceRosterEntry,
  AttendanceSession,
  PortalOpenAttendance,
} from './attendance.types';

/** Staff watching one session's roster fill in. */
export const sessionChannel = (sessionId: string) =>
  `attendance:session:${sessionId}`;

/** Everything live for one student account in the portal. */
export const portalUserChannel = (userProfileId: string) =>
  `portal:user:${userProfileId}`;

export type AttendanceStaffEvent =
  | { type: 'attendance.record'; data: AttendanceRosterEntry }
  | { type: 'attendance.closed'; data: AttendanceSession };

export type PortalEvent =
  | { type: 'attendance.opened'; data: PortalOpenAttendance }
  | { type: 'attendance.closed'; data: { sessionId: string; courseId: string } };

export type SseEvent = { type: string; data: unknown };

/** Attendance's view of the realtime bus. */
@Injectable()
export class AttendanceRealtime {
  constructor(private readonly bus: RedisPubSubService) {}

  publishStaff(sessionId: string, event: AttendanceStaffEvent) {
    return this.bus.publish(sessionChannel(sessionId), event);
  }

  async publishPortal(userProfileIds: string[], event: PortalEvent) {
    const unique = [...new Set(userProfileIds.filter(Boolean))];
    await Promise.all(
      unique.map((id) => this.bus.publish(portalUserChannel(id), event)),
    );
  }

  subscribeSession(sessionId: string, handler: (e: SseEvent) => void) {
    return this.bus.subscribe(sessionChannel(sessionId), (p) =>
      handler(p as SseEvent),
    );
  }

  subscribePortal(userProfileId: string, handler: (e: SseEvent) => void) {
    return this.bus.subscribe(portalUserChannel(userProfileId), (p) =>
      handler(p as SseEvent),
    );
  }
}
