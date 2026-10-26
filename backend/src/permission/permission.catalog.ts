export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

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
] as const;

export type Resource = (typeof RESOURCES)[number];

export type PermissionKey = `${Resource}:${Action}`;

// Resources without the full create/read/update/delete set. A key exists only
// when something enforces it:
// - school:update gates the school's own settings that are not a resource of
//   their own - billing (plan, payment, invoices). Admins hold it by default.
// - course: reading and deleting a course are decided by the course role
//   (CourseAccessService), so only create and update are school-wide powers.
// - student and join-code have read and update only (students self-register and
//   join via code; join codes are issued/revoked via update and inspected via read).
// - academic-year has no delete route.
const RESOURCE_ACTIONS: Partial<Record<Resource, readonly Action[]>> = {
  school: ['read', 'update'],
  course: ['create', 'update'],
  student: ['read', 'update'],
  'join-code': ['read', 'update'],
  'academic-year': ['create', 'read', 'update'],
};

export function actionsFor(resource: Resource): readonly Action[] {
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
};

const ACTION_VERBS: Record<Action, string> = {
  create: 'Create',
  read: 'View',
  update: 'Edit',
  delete: 'Delete',
};

const CUSTOM_DESCRIPTIONS: Partial<Record<PermissionKey, string>> = {
  'join-code:read': 'View school join code status',
  'join-code:update': 'Issue and revoke the school join code',
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

export const ROLE_DEFAULTS: Record<SystemRole, PermissionKey[] | '*'> = {
  admin: '*',

  // Teachers create their own courses and run them through their course role.
  teacher: [
    ...allKeys('announcement', 'file', 'chat'),
    permKey('course', 'create'),
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
  member: [
    ...readKeys(
      'student',
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
  if (defaults === '*') return new Set(PERMISSION_KEYS);
  return new Set(defaults);
}
