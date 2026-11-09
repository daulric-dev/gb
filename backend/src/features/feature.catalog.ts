/**
 * The platform features an organisation can switch on or off, and a school
 * admin can additionally switch off. Defined once here; the organisation's
 * overrides live in `public.organisation.features`, a school's opt-outs in
 * `public.school.disabled_features`.
 */
export interface FeatureDefinition {
  key: FeatureKey;
  label: string;
  description: string;
  /** Value when the organisation has not set it. */
  default: boolean;
  /** Features that must also be effective for this one to work. */
  requires: readonly FeatureKey[];
}

export const FEATURE_KEYS = [
  'messaging',
  'student_messaging',
  'chat_channels',
  'announcements',
  'discussions',
  'attendance',
  'files',
  'calendar',
  'course_copy',
  'push_notifications',
  'integrations',
  'report_cards',
  'parent_portal',
  'parent_notifications',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureMap = Record<FeatureKey, boolean>;

export const FEATURES: readonly FeatureDefinition[] = [
  {
    key: 'messaging',
    label: 'Messaging between staff',
    description: 'Direct messages between staff members of a school.',
    default: true,
    requires: [],
  },
  {
    key: 'student_messaging',
    label: 'Students can message their teachers',
    description:
      'Students can message the staff who teach their courses and reply to staff who message them. Students never message each other.',
    default: false,
    requires: ['messaging'],
  },
  {
    key: 'chat_channels',
    label: 'Group channels for staff',
    description: 'Staff can create group conversations with several members.',
    default: false,
    requires: ['messaging'],
  },
  {
    key: 'announcements',
    label: 'Announcements',
    description: 'School-wide and course announcements.',
    default: true,
    requires: [],
  },
  {
    key: 'discussions',
    label: 'Discussions',
    description: 'Course discussion boards for staff and students.',
    default: true,
    requires: [],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'Taking attendance, with check-in by code or QR.',
    default: true,
    requires: [],
  },
  {
    key: 'files',
    label: 'File manager & sharing',
    description:
      'The Files page: folders, organising and sharing files. Teachers can still upload files for course content when it is off.',
    default: true,
    requires: [],
  },
  {
    key: 'calendar',
    label: 'Calendar',
    description: 'The due-date calendar and its calendar (.ics) export.',
    default: true,
    requires: [],
  },
  {
    key: 'course_copy',
    label: 'Course templates & copying',
    description:
      'Copying courses, importing content between them and school templates.',
    default: true,
    requires: [],
  },
  {
    key: 'push_notifications',
    label: 'Push notifications',
    description: 'Notifications sent to the mobile app.',
    default: true,
    requires: [],
  },
  {
    key: 'integrations',
    label: 'Integrations (webhooks)',
    description:
      "Schools send platform events (grades, attendance, people, courses) to their own systems' URLs as signed webhooks. Off by default: data leaves the platform.",
    default: false,
    requires: [],
  },
  {
    key: 'report_cards',
    label: 'Report cards & transcripts',
    description:
      'Term report cards with teacher and head comments, published as PDFs to students, plus transcripts across terms.',
    default: true,
    requires: [],
  },
  {
    key: 'parent_portal',
    label: 'Parent portal',
    description:
      "Parents and guardians the school invites can sign in to see their own children's grades, upcoming and missing work, attendance and course announcements (read-only). Off by default.",
    default: false,
    requires: [],
  },
  {
    key: 'parent_notifications',
    label: 'Parent notifications',
    description:
      'Parents can opt in to email and push notices about missing work, absences, new grades and announcements.',
    default: false,
    requires: ['parent_portal'],
  },
];

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

export function isFeatureKey(key: unknown): key is FeatureKey {
  return typeof key === 'string' && BY_KEY.has(key as FeatureKey);
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
  return BY_KEY.get(key)!;
}

/**
 * The organisation's own setting per feature: its stored override when it
 * is a boolean, otherwise the default. Unknown keys and non-boolean values
 * are ignored.
 */
export function organisationSettings(stored: unknown): FeatureMap {
  const overrides =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const out = {} as FeatureMap;
  for (const f of FEATURES) {
    const v = overrides[f.key];
    out[f.key] = typeof v === 'boolean' ? v : f.default;
  }
  return out;
}

/**
 * Effective features: on where `allowed(key)` holds and every required
 * feature is effective too.
 */
function resolve(allowed: (key: FeatureKey) => boolean): FeatureMap {
  const out = {} as Partial<FeatureMap>;
  const visit = (key: FeatureKey, seen: Set<FeatureKey>): boolean => {
    if (out[key] !== undefined) return out[key];
    // A cycle in `requires` would be a catalog bug; treat it as off.
    if (seen.has(key)) return false;
    seen.add(key);
    const def = featureDefinition(key);
    const on = allowed(key) && def.requires.every((r) => visit(r, seen));
    out[key] = on;
    return on;
  };
  for (const f of FEATURES) visit(f.key, new Set());
  return out as FeatureMap;
}

/** Effective at the organisation level (no school context). */
export function effectiveForOrganisation(org: FeatureMap): FeatureMap {
  return resolve((key) => org[key]);
}

/**
 * Effective for a school: the organisation's value AND not disabled by the
 * school AND every required feature effective.
 */
export function effectiveForSchool(
  org: FeatureMap,
  disabled: readonly string[],
): FeatureMap {
  const off = new Set(disabled);
  return resolve((key) => org[key] && !off.has(key));
}
