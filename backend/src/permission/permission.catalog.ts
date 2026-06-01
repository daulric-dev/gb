/**
 * Code-owned catalog of permissionable (resource, action) pairs.
 *
 * This is the single source of truth for what can be permissioned. Schools
 * compose custom roles out of these keys; they do not invent new resources.
 * The catalog is mirrored into the public.permission_catalog table at app boot
 * (see PermissionCatalogSyncService) so the admin UI can list assignable
 * permissions, but the PermissionGuard checks against this constant directly.
 */

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

// One entry per feature controller surface. `grading` is split into the two
// underlying resources (assessment, grade) it manages.
export const RESOURCES = [
  'class',
  'attendance',
  'enrollment',
  'assessment',
  'grade',
  'reporting',
  'student',
  'subject',
  'term',
  'academic-year',
  'grade-scale',
  'calculation',
  'school',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type PermissionKey = `${Resource}:${Action}`;

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
  class: 'classes',
  attendance: 'attendance records',
  enrollment: 'class enrollments',
  assessment: 'assessments',
  grade: 'grades',
  reporting: 'reports',
  student: 'students',
  subject: 'subjects',
  term: 'academic terms',
  'academic-year': 'academic years',
  'grade-scale': 'grade scales',
  calculation: 'grade calculations',
  school: 'school settings',
};

const ACTION_VERBS: Record<Action, string> = {
  create: 'Create',
  read: 'View',
  update: 'Edit',
  delete: 'Delete',
};

/** The full catalog: every resource x every action. */
export const PERMISSION_CATALOG: CatalogEntry[] = RESOURCES.flatMap(
  (resource) =>
    ACTIONS.map((action) => ({
      resource,
      action,
      key: permKey(resource, action),
      description: `${ACTION_VERBS[action]} ${RESOURCE_LABELS[resource]}`,
    })),
);

/** Fast membership lookup for validating incoming keys. */
export const PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(
  PERMISSION_CATALOG.map((e) => e.key),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.has(value as PermissionKey);
}

const allKeys = (...resources: Resource[]): PermissionKey[] =>
  resources.flatMap((r) => ACTIONS.map((a) => permKey(r, a)));

const readKeys = (...resources: Resource[]): PermissionKey[] =>
  resources.map((r) => permKey(r, 'read'));

/**
 * Default permission sets for the legacy enum roles. `'*'` means the full
 * catalog. These are the code source of truth for enum-role defaults; the
 * guard unions them with any custom-role grants on the membership.
 */
export const ROLE_DEFAULTS: Record<SystemRole, PermissionKey[] | '*'> = {
  // Admins implicitly get everything within their own school (the guard
  // short-circuits before consulting this), but '*' keeps the map honest.
  admin: '*',

  // Teachers run day-to-day classroom workflows: full control over the
  // records they own, read access to the surrounding structure.
  teacher: [
    ...allKeys('attendance', 'assessment', 'grade', 'enrollment', 'reporting'),
    ...readKeys(
      'class',
      'student',
      'subject',
      'term',
      'academic-year',
      'grade-scale',
      'calculation',
    ),
  ],

  // Members get read-only visibility into the structures they belong to.
  member: readKeys(
    'class',
    'student',
    'subject',
    'term',
    'academic-year',
    'grade-scale',
    'reporting',
    'calculation',
  ),
};

/** Resolve the effective key set for an enum role. */
export function defaultsForRole(role: string): Set<PermissionKey> {
  const defaults = ROLE_DEFAULTS[role as SystemRole];
  if (!defaults) return new Set();
  if (defaults === '*') return new Set(PERMISSION_KEYS);
  return new Set(defaults);
}
