/**
 * Every webhook event type, defined once: its key (the body's `event_type` and
 * the `X-GradeBook-Event` header), group, label, description, how its
 * human-readable `message` is worded, the JSON Schema (draft 2020-12) of its
 * `data`, and an example. The admin UI
 * (`GET /api/webhooks/event-types`), validation of stored subscriptions, the
 * docs (docs/content/backend/webhooks.md) and the tests all read this file.
 *
 * Payloads carry ids plus minimal names (people: name and email; courses:
 * name and code; activities: title, kind, points) - never free-text bodies
 * beyond titles. Every event's `data` starts with `school: { id, name }`.
 */

export const WEBHOOK_API_VERSION = 1;

export const EVENT_GROUPS = [
  'grades_submissions',
  'attendance',
  'people',
  'courses',
  'system',
  'audit',
] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number];

export const EVENT_GROUP_LABELS: Record<EventGroup, string> = {
  grades_submissions: 'Grades & submissions',
  attendance: 'Attendance',
  people: 'People & enrolment',
  courses: 'Courses & content',
  system: 'System',
  audit: 'Audit log',
};

/** A JSON Schema (draft 2020-12) object, the subset this file uses. */
export interface JsonSchema {
  $schema?: string;
  type?: JsonType | JsonType[];
  description?: string;
  format?: string;
  enum?: readonly (string | number | boolean | null)[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minimum?: number;
}
type JsonType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

export interface WebhookEventType {
  key: string;
  group: EventGroup;
  label: string;
  description: string;
  /**
   * The body's `message`: one plain-text sentence built from `data`. Must cope
   * with missing names (see the fallbacks below); `eventMessage` tidies and
   * caps it.
   */
  message: (data: Record<string, unknown>) => string;
  /** JSON Schema of the envelope's `data`. */
  schema: JsonSchema;
  /** An example `data`. */
  example: Record<string, unknown>;
}

// ── shared shapes ────────────────────────────────────────────────────────────

const uuid: JsonSchema = { type: 'string', format: 'uuid' };
const uuidOrNull: JsonSchema = { type: ['string', 'null'], format: 'uuid' };
const text: JsonSchema = { type: 'string' };
const textOrNull: JsonSchema = { type: ['string', 'null'] };
const time: JsonSchema = { type: 'string', format: 'date-time' };
const timeOrNull: JsonSchema = {
  type: ['string', 'null'],
  format: 'date-time',
};
const numOrNull: JsonSchema = { type: ['number', 'null'] };

const obj = (
  properties: Record<string, JsonSchema>,
  description?: string,
  nullable = false,
): JsonSchema => ({
  type: nullable ? ['object', 'null'] : 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** An event's `data`: the school first, then the event's own fields. */
const eventData = (properties: Record<string, JsonSchema>): JsonSchema =>
  obj({ school: SCHOOL_SCHEMA, ...properties });

const person = (description: string, nullable = false) =>
  obj(
    {
      id: uuid,
      firstName: textOrNull,
      lastName: textOrNull,
      email: textOrNull,
    },
    description,
    nullable,
  );

/** A student: their student record id (not their account id). */
export const STUDENT_SCHEMA = person('The student (student record id)');
/** A staff member: their account (user profile) id. */
export const STAFF_SCHEMA = person('A staff member (user profile id)');
const STAFF_OR_NULL = person('A staff member (user profile id), or null', true);

export const COURSE_SCHEMA = obj(
  { id: uuid, name: text, code: textOrNull },
  'The course',
);

const ACTIVITY_KINDS = ['assignment', 'quiz', 'offline'] as const;
export const ACTIVITY_SCHEMA = obj(
  {
    id: uuid,
    title: text,
    kind: { type: 'string', enum: ACTIVITY_KINDS },
    points: numOrNull,
  },
  'The activity (assignment, quiz or offline work)',
);

const GRADE_SCHEMA = obj(
  {
    score: numOrNull,
    points: numOrNull,
    status: { type: 'string', enum: ['draft', 'submitted', 'graded'] },
    excused: { type: 'boolean' },
  },
  'The mark: score out of points; null score when excused without one',
);

/** The school the event happened in; first in every event's `data`. */
export const SCHOOL_SCHEMA = obj({ id: uuid, name: text }, 'The school');

const ATTENDANCE_STATUS: JsonSchema = {
  type: 'string',
  enum: ['present', 'late', 'absent', 'excused'],
};
const ROLE: JsonSchema = {
  type: ['string', 'null'],
  enum: ['admin', 'teacher', 'member', null],
};

// ── messages ────────────────────────────────────────────────────────────────

type Data = Record<string, unknown>;

/** `v` if it is a plain object, else an empty one (so lookups never throw). */
const rec = (v: unknown): Data =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {};
/** A non-blank string, trimmed, or null. */
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "First Last" (whichever parts there are), or null. */
function personName(v: unknown): string | null {
  const p = rec(v);
  return [str(p.firstName), str(p.lastName)].filter(Boolean).join(' ') || null;
}
const studentName = (d: Data) => personName(d.student) ?? 'A student';
const staffName = (d: Data) => personName(d.staff) ?? 'A staff member';
const courseName = (d: Data) => str(rec(d.course).name) ?? 'a course';
const activityTitle = (d: Data) => str(rec(d.activity).title) ?? 'an activity';
const schoolName = (d: Data) => str(rec(d.school).name) ?? 'the school';

const numText = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
/** "18/20", "18" (no points), or null (no score). */
function markText(grade: unknown): string | null {
  const g = rec(grade);
  const score = numText(g.score);
  if (score === null) return null;
  const points = numText(g.points);
  return points === null ? score : `${score}/${points}`;
}

function gradeMessage(d: Data): string {
  const where = `${activityTitle(d)} in ${courseName(d)}`;
  if (rec(d.grade).excused === true)
    return `${studentName(d)} was excused from ${where}`;
  const mark = markText(d.grade);
  return mark
    ? `${studentName(d)} received ${mark} for ${where}`
    : `${studentName(d)}'s mark for ${where} was cleared`;
}

export const MAX_MESSAGE_LENGTH = 280;

/**
 * The body's `message` for `type`: the type's sentence with whitespace and
 * control characters collapsed to single spaces, at most MAX_MESSAGE_LENGTH
 * characters (cut with "…"). Falls back to the type's label (or the key) when
 * the sentence can't be built. Plain text: receivers must not treat it as
 * HTML (names are the school's data, not escaped).
 */
export function eventMessage(type: string, data: unknown): string {
  const def = webhookEventType(type);
  let text: string;
  try {
    text = def ? def.message(rec(data)) : '';
  } catch {
    text = '';
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!text) text = def?.label ?? `GradeBook event ${type}`;
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
    : text;
}

// ── example values ──────────────────────────────────────────────────────────

const EX_SCHOOL = {
  id: '3c5e7a9b-1d3f-4a5c-8e7b-9d1f3a5c7e0b',
  name: 'Riverside High School',
};

const EX_STUDENT = {
  id: '6f1c2a0e-5b7d-4c3e-9a10-2d4e6f8a0b1c',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@students.riverside.edu',
};
const EX_STAFF = {
  id: '2b8e4d6f-1a3c-4e5f-8b7d-9c0a1e2f3d4b',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'g.hopper@riverside.edu',
};
const EX_COURSE = {
  id: '9d3f5b7a-2c4e-4a6b-8d0f-1e3a5c7b9d2f',
  name: 'Year 10 Mathematics',
  code: 'MATH10',
};
const EX_ACTIVITY = {
  id: '4a6c8e0b-3d5f-4b7a-9c1e-2f4a6b8c0d3e',
  title: 'Quadratics homework',
  kind: 'assignment',
  points: 20,
};
const EX_QUIZ = {
  ...EX_ACTIVITY,
  id: '5b7d9f1c-4e6a-4c8b-8d2f-3a5b7c9d1e4f',
  title: 'Fractions quiz',
  kind: 'quiz',
  points: 10,
};
const EX_SESSION_ID = '7c9e1a3d-5f7b-4d9c-8e3a-4b6c8d0e2f5a';
const EX_SUBMISSION_ID = '8d0f2b4e-6a8c-4e0d-9f4b-5c7d9e1f3a6b';

// ── the catalog ─────────────────────────────────────────────────────────────

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  // Grades & submissions
  {
    key: 'submission.handed_in',
    group: 'grades_submissions',
    label: 'Assignment handed in',
    message: (d) =>
      `${studentName(d)} handed in ${activityTitle(d)} in ${courseName(d)}`,
    description:
      'A student handed in an assignment (text, files or both). Quizzes send quiz.completed instead.',
    schema: eventData({
      submission: obj({ id: uuid, submittedAt: time }),
      activity: ACTIVITY_SCHEMA,
      course: COURSE_SCHEMA,
      student: STUDENT_SCHEMA,
    }),
    example: {
      school: EX_SCHOOL,
      submission: {
        id: EX_SUBMISSION_ID,
        submittedAt: '2026-11-04T09:15:00.000Z',
      },
      activity: EX_ACTIVITY,
      course: EX_COURSE,
      student: EX_STUDENT,
    },
  },
  {
    key: 'grade.recorded',
    group: 'grades_submissions',
    label: 'Mark entered or changed',
    message: gradeMessage,
    description:
      'A teacher entered or changed a mark, excused a student (or lifted it), or a gradebook CSV import changed a mark. One event per student and activity.',
    schema: eventData({
      submission: obj({ id: uuidOrNull }),
      activity: ACTIVITY_SCHEMA,
      course: COURSE_SCHEMA,
      student: STUDENT_SCHEMA,
      grade: GRADE_SCHEMA,
      gradedBy: STAFF_OR_NULL,
      source: { type: 'string', enum: ['teacher', 'excuse', 'import'] },
    }),
    example: {
      school: EX_SCHOOL,
      submission: { id: EX_SUBMISSION_ID },
      activity: EX_ACTIVITY,
      course: EX_COURSE,
      student: EX_STUDENT,
      grade: { score: 17.5, points: 20, status: 'graded', excused: false },
      gradedBy: EX_STAFF,
      source: 'teacher',
    },
  },
  {
    key: 'quiz.completed',
    group: 'grades_submissions',
    label: 'Quiz completed',
    message: (d) => {
      const mark = markText(d.grade);
      return `${studentName(d)} completed ${activityTitle(d)} in ${courseName(d)}${mark ? ` and scored ${mark}` : ''}`;
    },
    description:
      'A student submitted a quiz attempt; it was marked automatically.',
    schema: eventData({
      submission: obj({ id: uuid, attempt: { type: ['integer', 'null'] } }),
      activity: ACTIVITY_SCHEMA,
      course: COURSE_SCHEMA,
      student: STUDENT_SCHEMA,
      grade: GRADE_SCHEMA,
    }),
    example: {
      school: EX_SCHOOL,
      submission: { id: EX_SUBMISSION_ID, attempt: 1 },
      activity: EX_QUIZ,
      course: EX_COURSE,
      student: EX_STUDENT,
      grade: { score: 8, points: 10, status: 'graded', excused: false },
    },
  },

  // Attendance
  {
    key: 'attendance.session_opened',
    group: 'attendance',
    label: 'Attendance opened',
    message: (d) => {
      const title = str(rec(d.session).title);
      const what = `attendance${title ? ` (${title})` : ''} in ${courseName(d)}`;
      const by = personName(d.openedBy);
      return by ? `${by} opened ${what}` : `${cap(what)} opened`;
    },
    description: 'A teacher opened an attendance session in a course.',
    schema: eventData({
      session: obj({
        id: uuid,
        title: textOrNull,
        openedAt: time,
        closesAt: time,
        requiresCode: { type: 'boolean' },
        lateAfterMinutes: { type: ['integer', 'null'] },
      }),
      course: COURSE_SCHEMA,
      openedBy: STAFF_OR_NULL,
    }),
    example: {
      school: EX_SCHOOL,
      session: {
        id: EX_SESSION_ID,
        title: 'Period 1',
        openedAt: '2026-11-04T08:30:00.000Z',
        closesAt: '2026-11-04T08:45:00.000Z',
        requiresCode: true,
        lateAfterMinutes: 5,
      },
      course: EX_COURSE,
      openedBy: EX_STAFF,
    },
  },
  {
    key: 'attendance.session_closed',
    group: 'attendance',
    label: 'Attendance closed',
    message: (d) => {
      const title = str(rec(d.session).title);
      const c = rec(d.counts);
      const counts = (['present', 'late', 'absent', 'excused'] as const)
        .filter((k) => typeof c[k] === 'number')
        .map((k) => `${c[k] as number} ${k}`)
        .join(', ');
      return `Attendance${title ? ` (${title})` : ''} closed in ${courseName(d)}${counts ? `: ${counts}` : ''}`;
    },
    description:
      'An attendance session closed (early, or when its time ran out). Everyone who had not checked in was marked absent; the counts include them.',
    schema: eventData({
      session: obj({
        id: uuid,
        title: textOrNull,
        openedAt: time,
        closedAt: time,
      }),
      course: COURSE_SCHEMA,
      counts: obj({
        present: { type: 'integer' },
        late: { type: 'integer' },
        absent: { type: 'integer' },
        excused: { type: 'integer' },
      }),
    }),
    example: {
      school: EX_SCHOOL,
      session: {
        id: EX_SESSION_ID,
        title: 'Period 1',
        openedAt: '2026-11-04T08:30:00.000Z',
        closedAt: '2026-11-04T08:45:00.000Z',
      },
      course: EX_COURSE,
      counts: { present: 24, late: 2, absent: 3, excused: 1 },
    },
  },
  {
    key: 'attendance.recorded',
    group: 'attendance',
    label: 'Attendance recorded',
    message: (d) => {
      const status = str(rec(d.record).status);
      return `${studentName(d)} was marked ${status ?? 'for attendance'} in ${courseName(d)}`;
    },
    description:
      "A student checked in (code or QR), or a teacher set or changed a student's attendance. Absences filled in automatically at close are in attendance.session_closed's counts, not sent one by one.",
    schema: eventData({
      session: obj({ id: uuid }),
      course: COURSE_SCHEMA,
      student: STUDENT_SCHEMA,
      record: obj({
        status: ATTENDANCE_STATUS,
        method: { type: 'string', enum: ['self', 'qr', 'teacher', 'auto'] },
        checkedInAt: timeOrNull,
      }),
      recordedBy: STAFF_OR_NULL,
    }),
    example: {
      school: EX_SCHOOL,
      session: { id: EX_SESSION_ID },
      course: EX_COURSE,
      student: EX_STUDENT,
      record: {
        status: 'late',
        method: 'qr',
        checkedInAt: '2026-11-04T08:37:12.000Z',
      },
      recordedBy: null,
    },
  },

  // People & enrolment
  {
    key: 'student.joined_school',
    group: 'people',
    label: 'Student joined the school',
    message: (d) =>
      `${studentName(d)} joined ${schoolName(d)}${d.via === 'email_domain' ? ' with a student email address' : d.via === 'join_code' ? ' with the join code' : ''}`,
    description:
      'A student joined the school with its join code or a student email domain.',
    schema: eventData({
      student: STUDENT_SCHEMA,
      via: { type: 'string', enum: ['join_code', 'email_domain'] },
    }),
    example: { school: EX_SCHOOL, student: EX_STUDENT, via: 'join_code' },
  },
  {
    key: 'student.left_school',
    group: 'people',
    label: 'Student marked inactive',
    message: (d) => `${studentName(d)} was marked inactive at ${schoolName(d)}`,
    description:
      'A school admin marked a student inactive (the student has left). Students have no other way to leave a school; their record and marks stay.',
    schema: eventData({
      student: STUDENT_SCHEMA,
      via: { type: 'string', enum: ['marked_inactive'] },
    }),
    example: { school: EX_SCHOOL, student: EX_STUDENT, via: 'marked_inactive' },
  },
  {
    key: 'student.enrolled',
    group: 'people',
    label: 'Student enrolled in a course',
    message: (d) =>
      d.via === 'join_code'
        ? `${studentName(d)} joined ${courseName(d)} with its join code`
        : `${studentName(d)} was enrolled in ${courseName(d)}`,
    description:
      "A student was added to a course by its staff, or joined it with the course's code.",
    schema: eventData({
      student: STUDENT_SCHEMA,
      course: COURSE_SCHEMA,
      via: { type: 'string', enum: ['staff', 'join_code'] },
    }),
    example: {
      school: EX_SCHOOL,
      student: EX_STUDENT,
      course: EX_COURSE,
      via: 'staff',
    },
  },
  {
    key: 'student.unenrolled',
    group: 'people',
    label: 'Student removed from a course',
    message: (d) =>
      `${studentName(d)} was removed from ${courseName(d)}${d.dropped === true ? ' (kept as dropped)' : ''}`,
    description:
      'A student was removed from a course. `dropped` is true when they had work in it (kept, marked dropped), false when the enrolment was deleted.',
    schema: eventData({
      student: STUDENT_SCHEMA,
      course: COURSE_SCHEMA,
      dropped: { type: 'boolean' },
    }),
    example: {
      school: EX_SCHOOL,
      student: EX_STUDENT,
      course: EX_COURSE,
      dropped: true,
    },
  },
  {
    key: 'staff.joined',
    group: 'people',
    label: 'Staff member joined',
    message: (d) => {
      const role = str(d.role);
      return `${staffName(d)} joined ${schoolName(d)}${role ? ` as ${role === 'admin' ? 'an' : 'a'} ${role}` : ''}`;
    },
    description:
      'A school admin approved a join request, or a staff member joined with a staff email domain.',
    schema: eventData({
      staff: STAFF_SCHEMA,
      role: ROLE,
      via: { type: 'string', enum: ['join_request', 'email_domain'] },
    }),
    example: {
      school: EX_SCHOOL,
      staff: EX_STAFF,
      role: 'teacher',
      via: 'join_request',
    },
  },
  {
    key: 'staff.left',
    group: 'people',
    label: 'Staff member left',
    message: (d) =>
      d.via === 'removed'
        ? `${staffName(d)} was removed from ${schoolName(d)}`
        : `${staffName(d)} left ${schoolName(d)}`,
    description:
      'A staff member left the school, or a school admin removed them.',
    schema: eventData({
      staff: STAFF_SCHEMA,
      via: { type: 'string', enum: ['left', 'removed'] },
    }),
    example: { school: EX_SCHOOL, staff: EX_STAFF, via: 'removed' },
  },
  {
    key: 'staff.role_changed',
    group: 'people',
    label: "Staff member's role changed",
    message: (d) => {
      const r = rec(d.role);
      const before = str(r.before) ?? 'no role';
      const after = str(r.after) ?? 'no role';
      return `${staffName(d)}'s role changed from ${before} to ${after}`;
    },
    description:
      "A school admin changed a staff member's base role (admin, teacher, member). Custom role grants are not sent.",
    schema: eventData({
      staff: STAFF_SCHEMA,
      role: obj({ before: ROLE, after: ROLE }),
    }),
    example: {
      school: EX_SCHOOL,
      staff: EX_STAFF,
      role: { before: 'teacher', after: 'admin' },
    },
  },

  // Courses & content
  {
    key: 'course.created',
    group: 'courses',
    label: 'Course created',
    message: (d) => {
      const by = personName(d.createdBy);
      return by
        ? `${by} created ${courseName(d)}`
        : `${cap(courseName(d))} was created`;
    },
    description: 'A course was created (from scratch or as a copy).',
    schema: eventData({ course: COURSE_SCHEMA, createdBy: STAFF_OR_NULL }),
    example: { school: EX_SCHOOL, course: EX_COURSE, createdBy: EX_STAFF },
  },
  {
    key: 'course.archived',
    group: 'courses',
    label: 'Course archived',
    message: (d) => `${cap(courseName(d))} was archived`,
    description: 'A course was archived.',
    schema: eventData({ course: COURSE_SCHEMA }),
    example: { school: EX_SCHOOL, course: EX_COURSE },
  },
  {
    key: 'activity.published',
    group: 'courses',
    label: 'Activity published',
    message: (d) => {
      const kind = str(rec(d.activity).kind);
      const noun =
        kind === 'quiz'
          ? 'Quiz'
          : kind === 'offline'
            ? 'Activity'
            : 'Assignment';
      const title = str(rec(d.activity).title);
      return title
        ? `${noun} ${title} was published in ${courseName(d)}`
        : `A new ${noun.toLowerCase()} was published in ${courseName(d)}`;
    },
    description:
      'An assignment, quiz or offline activity was published (or reopened) to students.',
    schema: eventData({
      activity: obj({
        id: uuid,
        title: text,
        kind: { type: 'string', enum: ACTIVITY_KINDS },
        points: numOrNull,
        dueAt: timeOrNull,
      }),
      course: COURSE_SCHEMA,
    }),
    example: {
      school: EX_SCHOOL,
      activity: { ...EX_ACTIVITY, dueAt: '2026-11-11T23:59:00.000Z' },
      course: EX_COURSE,
    },
  },
  {
    key: 'announcement.posted',
    group: 'courses',
    label: 'Announcement posted',
    message: (d) => {
      const title = str(rec(d.announcement).title);
      const what = title ? `the announcement "${title}"` : 'an announcement';
      const where =
        rec(d.announcement).scope === 'course' && d.course
          ? `in ${courseName(d)}`
          : `to ${schoolName(d)}`;
      const by = personName(d.author);
      return by
        ? `${by} posted ${what} ${where}`
        : `${cap(what)} was posted ${where}`;
    },
    description:
      'A school-wide or course announcement was posted. Only the title is sent, never the body.',
    schema: eventData({
      announcement: obj({
        id: uuid,
        title: text,
        scope: { type: 'string', enum: ['school', 'course'] },
      }),
      course: {
        ...COURSE_SCHEMA,
        type: ['object', 'null'],
        description: 'The course, for a course announcement',
      },
      author: STAFF_OR_NULL,
    }),
    example: {
      school: EX_SCHOOL,
      announcement: {
        id: '1e3a5c7b-9d2f-4b4d-8f6a-7c9e1a3d5f8b',
        title: 'Exam timetable published',
        scope: 'course',
      },
      course: EX_COURSE,
      author: EX_STAFF,
    },
  },

  // Audit log
  {
    key: 'audit.changed',
    group: 'audit',
    label: 'Audit log change',
    message: (d) => {
      const audit = rec(d.audit);
      const actor = rec(audit.actor);
      const who = str(actor.name) ?? str(actor.email) ?? 'A user';
      const action = str(audit.action) ?? 'changed';
      const entity = str(audit.entity) ?? 'a record';
      return `${who} ${action === 'create' ? 'created' : action === 'delete' ? 'deleted' : 'updated'} ${entity} in ${schoolName(d)}`;
    },
    description:
      'A school-scoped audit-log entry, including redacted before/after values and actor details. Contains personal data; subscribe only if this receiver is trusted.',
    schema: eventData({
      audit: obj({
        id: uuid,
        entity: text,
        entityId: textOrNull,
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        actor: obj({
          id: uuid,
          name: textOrNull,
          email: textOrNull,
        }),
        changes: { type: 'object', additionalProperties: true },
        createdAt: time,
      }),
    }),
    example: {
      school: EX_SCHOOL,
      audit: {
        id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
        entity: 'term',
        entityId: '5b7d9f1c-4e6a-4c8b-8d2f-3a5b7c9d1e4f',
        action: 'update',
        actor: { id: EX_STAFF.id, name: 'Grace Hopper', email: EX_STAFF.email },
        changes: { name: { before: 'Autumn', after: 'Fall' } },
        createdAt: '2026-11-04T09:15:00.000Z',
      },
    },
  },

  // System
  {
    key: 'ping',
    group: 'system',
    label: 'Test (ping)',
    message: () => 'Test event from GradeBook',
    description:
      'Sent by the Test button, to check the URL and your signature verification. Always delivered to the webhook being tested, whatever it subscribes to.',
    schema: eventData({
      webhook: obj({ id: uuid, name: text }),
    }),
    example: {
      school: EX_SCHOOL,
      webhook: {
        id: '0a2c4e6f-8b1d-4f3a-9c5e-6d8f0a2b4c7d',
        name: 'Student information system',
      },
    },
  },
];

export type WebhookEventKey = string;

const BY_KEY = new Map(WEBHOOK_EVENT_TYPES.map((t) => [t.key, t]));

/** Every key, in catalog order. */
export const WEBHOOK_EVENT_KEYS: readonly string[] = WEBHOOK_EVENT_TYPES.map(
  (t) => t.key,
);

export function isWebhookEventKey(key: unknown): key is WebhookEventKey {
  return typeof key === 'string' && BY_KEY.has(key);
}

export function webhookEventType(key: string): WebhookEventType | undefined {
  return BY_KEY.get(key);
}

/** What `GET /api/webhooks/event-types` returns for each type. */
export function eventTypeCatalog() {
  return {
    apiVersion: WEBHOOK_API_VERSION,
    groups: EVENT_GROUPS.map((g) => ({ key: g, label: EVENT_GROUP_LABELS[g] })),
    eventTypes: WEBHOOK_EVENT_TYPES.map((t) => ({
      key: t.key,
      group: t.group,
      label: t.label,
      description: t.description,
      exampleMessage: eventMessage(t.key, t.example),
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        ...t.schema,
      },
      example: t.example,
    })),
  };
}

/**
 * A subscription as stored: `"*"` stands for every current type (except
 * `ping`, which only the Test button sends); anything else must be a known
 * key. Deduplicated, in catalog order. Throws on an unknown key.
 */
export function expandEvents(events: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const e of events) {
    if (e === '*') {
      for (const k of WEBHOOK_EVENT_KEYS) if (k !== 'ping') wanted.add(k);
    } else if (isWebhookEventKey(e)) {
      wanted.add(e);
    } else {
      throw new UnknownEventTypeError(e);
    }
  }
  return WEBHOOK_EVENT_KEYS.filter((k) => wanted.has(k));
}

export class UnknownEventTypeError extends Error {
  constructor(readonly eventType: string) {
    super(`Unknown event type "${eventType}"`);
  }
}

// ── validation ──────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number')
    return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value as JsonType;
}

/**
 * Checks `value` against the subset of JSON Schema this catalog uses (type,
 * enum, properties, required, additionalProperties, items, uuid and
 * date-time formats). Returns the problems found; empty means valid.
 */
export function validateSchema(
  schema: JsonSchema,
  value: unknown,
  path = 'data',
): string[] {
  const errors: string[] = [];
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = allowed.some(
      (t) => t === actual || (t === 'number' && actual === 'integer'),
    );
    if (!ok)
      return [`${path}: expected ${allowed.join(' or ')}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(
      `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    );
  }
  if (typeof value === 'string' && schema.format) {
    if (schema.format === 'uuid' && !UUID_RE.test(value))
      errors.push(`${path}: not a uuid`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: not a date-time`);
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, v] of Object.entries(record)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validateSchema(sub, v, `${path}.${key}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}.${key}: not allowed`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) =>
      errors.push(...validateSchema(schema.items!, v, `${path}[${i}]`)),
    );
  }
  return errors;
}

/** Problems with `data` for event `type` (unknown type included). */
export function validateEventData(type: string, data: unknown): string[] {
  const def = webhookEventType(type);
  if (!def) return [`unknown event type "${type}"`];
  return validateSchema(def.schema, data);
}
