export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
/**
 * Actions beyond the CRUD four, only ever listed explicitly in
 * RESOURCE_ACTIONS (never a default):
 * - `safeguarding`: the stricter key that pastoral notes in a safeguarding
 *   category need on top of read/create/update.
 * - `read-all`: student:read-all, every student of the school. Without it
 *   student:read covers only the caller's own students (their courses and
 *   tutees, see student-access.ts).
 * - `sensitive`: student:sensitive, guardian contacts and accommodation
 *   reasons.
 * - `export`: student:export, a subject-access export of one student.
 * - `erase`: student:erase, erasing a student record.
 */
export const EXTRA_ACTIONS = [
  'safeguarding',
  'read-all',
  'sensitive',
  'export',
  'erase',
] as const;
export type Action =
  | (typeof ACTIONS)[number]
  | (typeof EXTRA_ACTIONS)[number];

// One entry per school-level surface. Work inside a course (content, marking,
// people) is governed by the caller's course role instead - see
// CourseAccessService - so it has no catalog keys of its own. `course` here is
// the school-wide power: creating courses, and with update/delete, managing
// every course in the school as an admin would.
export const RESOURCES = [
  'course',
  'student',
  'term',
  'academic-year',
  'grade-scale',
  'school',
  'announcement',
  'file',
  'chat',
  'join-code',
  'audit-log',
  'report-card',
  'attendance-report',
  'course-library',
  'pastoral-note',
  'analytics',
] as const;

export type Resource = (typeof RESOURCES)[number];

export type PermissionKey = `${Resource}:${Action}`;

// Resources without the full create/read/update/delete set. A key exists only
// when something enforces it:
// - school:update gates the school's own settings that are not a resource of
//   their own (upload limit, logo). Admins hold it by default.
// - course: reading and deleting a course are decided by the course role
//   (CourseAccessService), so only create and update are school-wide powers.
// - student has read and update (students self-register and join via code),
//   plus read-all, sensitive, export and erase (EXTRA_ACTIONS).
// - join-code has read and update only (join codes are issued/revoked via
//   update and inspected via read).
// - academic-year has no delete route.
const RESOURCE_ACTIONS: Partial<Record<Resource, readonly Action[]>> = {
  school: ['read', 'update'],
  course: ['create', 'update'],
  student: ['read', 'update', 'read-all', 'sensitive', 'export', 'erase'],
  'join-code': ['read', 'update'],
  'audit-log': ['read'],
  // report-card: read = the release dashboard, previews and any student's
  // report; update = head comments, deadlines, publishing. Teachers write
  // their own course comments through their course role, not this key.
  'report-card': ['read', 'update'],
  // attendance-report: read = the school attendance report, any student's
  // attendance report and their CSV exports, and every open alert. Alert
  // settings stay on school:update and form tutors on student:update.
  'attendance-report': ['read'],
  'academic-year': ['create', 'read', 'update'],
  // course-library: create = publish a library item (template) visible to
  // every school in the organisation. Publishing for your own school only
  // needs a manage role on the source course.
  'course-library': ['create'],
  // pastoral-note: read / create / update staff notes about students;
  // safeguarding is additionally needed to see, create or change a note in a
  // safeguarding category. There is no plain delete key: deleting a note is
  // an erasure and needs update (src/pastoral).
  'pastoral-note': ['read', 'create', 'update', 'safeguarding'],
  // analytics: read = the school analytics page (roll-ups per course and
  // teacher, the school at-risk list, their CSV exports and refresh) and any
  // course's analytics. Course staff always see their own course's analytics
  // through their course role, without this key (src/analytics).
  analytics: ['read'],
};

export function actionsFor(resource: Resource): readonly Action[] {
  // Extra actions exist only where RESOURCE_ACTIONS lists them.
  return RESOURCE_ACTIONS[resource] ?? ACTIONS;
}

export function permKey(resource: Resource, action: Action): PermissionKey {
  return `${resource}:${action}`;
}

export type SystemRole = 'admin' | 'teacher' | 'member';

export interface CatalogEntry {
  resource: Resource;
  action: Action;
  key: PermissionKey;
  description: string;
}

const RESOURCE_LABELS: Record<Resource, string> = {
  course: 'courses',
  student: 'students',
  term: 'academic terms',
  'academic-year': 'academic years',
  'grade-scale': 'grade scales',
  school: 'school settings',
  announcement: 'announcements',
  file: 'files',
  chat: 'chat messages',
  'join-code': 'school join code',
  'audit-log': 'audit log',
  'report-card': 'report cards',
  'attendance-report': 'attendance reports',
  'course-library': 'course library',
  'pastoral-note': 'pastoral notes',
  analytics: 'analytics',
};

const ACTION_VERBS: Record<Action, string> = {
  create: 'Create',
  read: 'View',
  update: 'Edit',
  delete: 'Delete',
  safeguarding: 'Safeguarding',
  'read-all': 'View all',
  sensitive: 'View sensitive details of',
  export: 'Export',
  erase: 'Erase',
};

const CUSTOM_DESCRIPTIONS: Partial<Record<PermissionKey, string>> = {
  'student:read':
    'View students: only those in courses you teach and your tutees, unless the role also has View all',
  'student:read-all': 'View every student in the school (with View students)',
  'student:sensitive':
    'See guardian contact details and accommodation reasons (with View students)',
  'student:export': "Export everything held about a student (subject access request)",
  'student:erase': 'Erase a student record',
  'join-code:read': 'View school join code status',
  'join-code:update': 'Issue and revoke the school join code',
  'report-card:read': 'View report card progress, previews and published reports',
  'report-card:update': 'Write head comments and publish report cards',
  'attendance-report:read': "View the school attendance report and any student's attendance",
  'course-library:create': 'Share course templates with every school in the organisation',
  'pastoral-note:read': 'View behaviour and pastoral notes about students',
  'pastoral-note:create': 'Write behaviour and pastoral notes',
  'pastoral-note:update': 'Edit, resolve and delete behaviour and pastoral notes',
  'pastoral-note:safeguarding':
    'See, write and edit safeguarding notes (with the read, create or edit key). Never included automatically, not even for admins',
  'analytics:read': 'View school analytics (roll-ups per course and teacher) and students at risk in any course',
};

/** The full catalog: every resource x each action it supports. */
export const PERMISSION_CATALOG: CatalogEntry[] = RESOURCES.flatMap(
  (resource) =>
    actionsFor(resource).map((action) => {
      const key = permKey(resource, action);
      return {
        resource,
        action,
        key,
        description:
          CUSTOM_DESCRIPTIONS[key] ??
          `${ACTION_VERBS[action]} ${RESOURCE_LABELS[resource]}`,
      };
    }),
);

/** Fast membership lookup for validating incoming keys. */
export const PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(
  PERMISSION_CATALOG.map((e) => e.key),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.has(value as PermissionKey);
}

const allKeys = (...resources: Resource[]): PermissionKey[] =>
  resources.flatMap((r) => actionsFor(r).map((a) => permKey(r, a)));
const readKeys = (...resources: Resource[]): PermissionKey[] =>
  resources.map((r) => permKey(r, 'read'));

/**
 * Keys that are never granted implicitly: not part of the admin `'*'`
 * expansion, not given to organisation admins, only ever held through a
 * role that lists them. Granting one needs step-up and is audit-logged
 * (PermissionService.setRolePermissions).
 */
export const EXPLICIT_ONLY_KEYS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'pastoral-note:safeguarding',
]);

export const ROLE_DEFAULTS: Record<SystemRole, PermissionKey[] | '*'> = {
  // Everything except EXPLICIT_ONLY_KEYS (see defaultsForRole).
  admin: '*',

  // Teachers create their own courses and run them through their course role.
  teacher: [
    ...allKeys('announcement', 'file', 'chat'),
    permKey('course', 'create'),
    // Teachers can record a note and always see their own; reading other
    // staff's notes is granted by a role (pastoral lead, head of year).
    permKey('pastoral-note', 'create'),
    // student:read alone: only the students in their own courses and their
    // tutees. Seeing every student is student:read-all (office, pastoral).
    ...readKeys(
      'student',
      'term',
      'academic-year',
      'grade-scale',
      'school',
      'join-code',
    ),
  ],

  // Members get read-only visibility into the structures they belong to,
  // plus the ability to manage their own files (upload, view, share own).
  // No student:read: a member with no courses has no students of their own;
  // a role grants it (with read-all for office staff).
  member: [
    ...readKeys(
      'term',
      'academic-year',
      'grade-scale',
      'announcement',
      'file',
      'school',
      'join-code',
    ),
    // Own-file management: ownership is enforced per-file in the service.
    permKey('file', 'create'),
    permKey('file', 'update'),
    permKey('file', 'delete'),
    // Everyone can message others in their school; ownership of a given
    // message/conversation is enforced per-row in the chat service.
    ...allKeys('chat'),
  ],
};

/** Resolve the effective key set for an enum role. */
export function defaultsForRole(role: string): Set<PermissionKey> {
  const defaults = ROLE_DEFAULTS[role as SystemRole];
  if (!defaults) return new Set();
  if (defaults === '*') {
    return new Set(
      [...PERMISSION_KEYS].filter((key) => !EXPLICIT_ONLY_KEYS.has(key)),
    );
  }
  return new Set(defaults);
}
