import type { Collector } from '../data-export.types';
import { courseNames, studentIn } from './helpers';

export const attendanceCollector: Collector = {
  id: 'attendance',
  title: 'Attendance',
  description:
    'Attendance for each class session: status (present, late, absent, excused), how it was taken (teacher, code, QR scan, location), the check-in time, the teacher\'s note, and the distance and location of a location check-in where the location is still stored.',
  covers: ['course.attendance_record.student_id'],
  scopes: ['self', 'staff', 'parent'],
  parentSetting: 'showAttendance',
  async collect(ctx) {
    if (ctx.subject.studentIds.length === 0) return { data: [], count: 0 };
    const parent = ctx.subject.scope === 'parent';
    const rows = await ctx.prisma.course_attendance_record.findMany({
      where: { student_id: studentIn(ctx), ...(ctx.subject.schoolId ? { course: { school_id: ctx.subject.schoolId } } : {}) },
      select: {
        course_id: true,
        status: true,
        method: true,
        checked_in_at: true,
        distance_m: true,
        latitude: true,
        longitude: true,
        accuracy_m: true,
        note: true,
        created_at: true,
        updated_at: true,
        attendance_session: { select: { title: true, opened_at: true } },
      },
      orderBy: { created_at: 'asc' },
    });
    const courses = await courseNames(ctx, rows.map((r) => r.course_id));
    const data = rows.map((r) => {
      const base = {
        course: courses.get(r.course_id) ?? null,
        session: r.attendance_session.title,
        sessionOpenedAt: r.attendance_session.opened_at,
        status: r.status,
        method: r.method,
        checkedInAt: r.checked_in_at,
      };
      if (parent) return base;
      return {
        ...base,
        note: r.note,
        distanceMetres: r.distance_m,
        location:
          r.latitude != null && r.longitude != null
            ? { latitude: r.latitude, longitude: r.longitude, accuracyMetres: r.accuracy_m }
            : null,
        recordedAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
    return { data, count: data.length };
  },
};
