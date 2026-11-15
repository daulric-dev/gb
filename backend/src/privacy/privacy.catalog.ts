/**
 * What the privacy notice is built from: the purposes GradeBook processes
 * personal data for, the lawful bases an organisation may choose for each
 * (with defaults that suit most schools), and the retention periods the
 * install is configured with. The web notice (`/privacy`) renders these.
 */

/** GDPR Art 6 bases, plus the Art 9 conditions for special-category data. */
export const LAWFUL_BASES = {
  public_task: 'Public task (Art 6(1)(e)): the school\'s official function of providing education',
  legitimate_interests: 'Legitimate interests (Art 6(1)(f))',
  legal_obligation: 'Legal obligation (Art 6(1)(c))',
  vital_interests: 'Vital interests (Art 6(1)(d)): protecting someone\'s life or safety',
  contract: 'Contract (Art 6(1)(b))',
  consent: 'Consent (Art 6(1)(a)), which can be withdrawn at any time',
  art9_substantial_public_interest:
    'Special category data: substantial public interest, such as safeguarding children (Art 9(2)(g))',
  art9_vital_interests: 'Special category data: vital interests (Art 9(2)(c))',
  art9_employment_social_protection:
    'Special category data: employment and social protection law (Art 9(2)(b))',
  art9_explicit_consent: 'Special category data: explicit consent (Art 9(2)(a))',
} as const;

export type LawfulBasis = keyof typeof LAWFUL_BASES;

export const LAWFUL_BASIS_KEYS = Object.keys(LAWFUL_BASES) as LawfulBasis[];

export interface PurposeDefinition {
  key: string;
  label: string;
  /** The default bases for a school; the organisation can override them. */
  defaults: LawfulBasis[];
}

/**
 * Processing purposes, in the order the notice lists them. Defaults: a
 * state school's public task (an independent school would pick legitimate
 * interests), legal obligation where schools must keep the record, vital
 * interests for safeguarding emergencies, consent only for translation,
 * which runs only when a person chooses it.
 */
export const PURPOSES: readonly PurposeDefinition[] = [
  { key: 'education', label: 'Running courses, coursework, marking, grades and reports', defaults: ['public_task'] },
  { key: 'accounts', label: 'Accounts, sign-in and keeping accounts secure', defaults: ['public_task', 'legitimate_interests'] },
  { key: 'attendance', label: 'Attendance records and attendance alerts to staff and parents', defaults: ['legal_obligation', 'public_task'] },
  { key: 'location_checkin', label: 'Location check during attendance check-in (only when a teacher turns it on)', defaults: ['public_task'] },
  { key: 'communication', label: 'Messages, announcements, discussions and notifications', defaults: ['public_task'] },
  { key: 'parent_portal', label: 'Parent and guardian access to their child\'s records', defaults: ['public_task'] },
  { key: 'safeguarding', label: 'Pastoral and safeguarding notes', defaults: ['legal_obligation', 'vital_interests', 'art9_substantial_public_interest'] },
  { key: 'accommodations', label: 'Assessment accommodations (which may reveal health or disability information)', defaults: ['public_task', 'art9_substantial_public_interest'] },
  { key: 'analytics', label: 'Analytics and at-risk lists for staff', defaults: ['public_task'] },
  { key: 'ai', label: 'AI assistance for staff', defaults: ['public_task'] },
  { key: 'similarity', label: 'Similarity checks on submitted work', defaults: ['public_task'] },
  { key: 'exam_integrity', label: 'Lockdown quizzes: noticing when a student leaves the quiz screen', defaults: ['public_task'] },
  { key: 'translation', label: 'Translating pages into another language, when a person chooses it', defaults: ['consent'] },
  { key: 'integrations', label: 'Integrations the school sets up: rostering, external tools (LTI) and webhooks', defaults: ['public_task'] },
  { key: 'security_audit', label: 'Security logs, audit logs and backups', defaults: ['legitimate_interests', 'legal_obligation'] },
];

export const PURPOSE_KEYS = PURPOSES.map((p) => p.key);

/** One retention row of the notice. */
export interface RetentionItem {
  key: string;
  label: string;
  /** Human-readable period, from the environment or a fixed rule. */
  period: string;
  /** The environment variable that sets it, when there is one. */
  env?: string;
}

type Env = Record<string, string | undefined>;

/** How a variable's value is read: the same rule as the code that enforces it. */
type Reader =
  /** envInt: a whole number >= 0, else the default (src/erasure/erasure.config.ts). */
  | 'int'
  /** A whole number clamped into [min, max] (an invalid value is the default first). */
  | 'clamp'
  /** In [min, max] or the default (no clamping): TRANSLATION_CACHE_TTL_HOURS. */
  | 'range'
  /** A number >= min, else the default (src/account/session.config.ts). */
  | 'atLeast';

interface RetentionDefinition {
  key: string;
  label: string;
  env?: string;
  unit?: 'days' | 'hours';
  default?: number;
  read?: Reader;
  min?: number;
  max?: number;
  /** Fixed text, or a template where `{n}` is the configured number. */
  text: string;
  /** What 0 means, for variables where 0 switches the purge off or makes it immediate. */
  zero?: string;
  /** Builds the period itself (from the number already read). */
  period?: (n: number, env: Env) => string;
}

const SOFT_DELETE_KINDS: readonly [string, string][] = [
  ['SOFT_DELETE_RETENTION_DAYS_FILES', 'files'],
  ['SOFT_DELETE_RETENTION_DAYS_FOLDERS', 'folders'],
  ['SOFT_DELETE_RETENTION_DAYS_CHAT_MESSAGES', 'chat messages'],
  ['SOFT_DELETE_RETENTION_DAYS_DISCUSSION_REPLIES', 'discussion posts'],
];

/** "after 30 days", or "at the next daily purge" for 0. */
const afterDays = (n: number) => (n === 0 ? 'at the next daily purge' : `after ${plural(n, 'days')}`);

/**
 * Retention rows. `env`, `default` and `read` must match the code that
 * enforces the period (src/retention/retention.config.ts,
 * src/account/session.config.ts, src/data-export/data-export.constants.ts,
 * src/translation/translation.constants.ts, ...); the notice reads the same
 * variables so it states what this install does.
 */
const RETENTION: readonly RetentionDefinition[] = [
  {
    key: 'school_records',
    label: 'School records (courses, coursework, grades, attendance, reports)',
    text: 'For as long as the school keeps them; the school deletes or erases records of people who have left',
  },
  {
    key: 'soft_deleted',
    label: 'Deleted files, folders, chat messages and discussion posts',
    env: 'SOFT_DELETE_RETENTION_DAYS',
    unit: 'days',
    default: 30,
    read: 'int',
    text: 'Hidden at once, erased for good {after}',
    // SOFT_DELETE_RETENTION_DAYS_<KIND> overrides the period for one kind.
    period: (n, env) => {
      const base = `Hidden at once, erased for good ${afterDays(n)}`;
      const overrides = SOFT_DELETE_KINDS.flatMap(([name, what]) => {
        const v = readInt(env, name, n);
        return v === n ? [] : [`${what} ${afterDays(v)}`];
      });
      return overrides.length ? `${base} (${overrides.join('; ')})` : base;
    },
  },
  {
    key: 'attendance_location',
    label: 'Location coordinates from attendance check-ins',
    env: 'ATTENDANCE_LOCATION_RETENTION_HOURS',
    unit: 'hours',
    default: 24,
    read: 'int',
    text: 'Used for the distance check and cleared within {n} of the session closing; the distance, its accuracy and the location flags are kept',
    zero:
      'Used for the distance check and cleared at the next daily run after the session closes; the distance, its accuracy and the location flags are kept',
  },
  {
    key: 'pastoral',
    label: 'Pastoral and safeguarding notes',
    text: 'As set by each school in its pastoral settings, in line with safeguarding law',
  },
  {
    key: 'notifications',
    label: 'In-app notifications',
    env: 'NOTIFICATION_RETENTION_DAYS',
    unit: 'days',
    default: 180,
    read: 'int',
    text: '{n}',
    zero: 'Kept until the account or school is deleted (automatic removal is switched off)',
  },
  {
    key: 'audit_log',
    label: 'Audit logs (school records, sign-in and integrations)',
    env: 'AUDIT_LOG_RETENTION_DAYS',
    unit: 'days',
    default: 730,
    read: 'clamp',
    min: 1,
    text: '{n}',
  },
  {
    key: 'roster_history',
    label: 'Rostering run history',
    env: 'ROSTER_HISTORY_RETENTION_DAYS',
    unit: 'days',
    default: 90,
    read: 'int',
    text: '{n}',
    zero: 'Kept until deleted (automatic removal is switched off)',
  },
  {
    key: 'webhook_deliveries',
    label: 'Webhook delivery records (the data sent to a school\'s webhook)',
    env: 'WEBHOOK_DELIVERY_RETENTION_DAYS',
    unit: 'days',
    default: 30,
    read: 'clamp',
    min: 1,
    text: '{n}',
  },
  {
    key: 'ai_requests',
    label: 'AI request log',
    text: 'One year (who, when, which feature; prompts and answers are stored only if the organisation turned that on, and then for 30 days)',
  },
  {
    key: 'translation_cache',
    label: 'Translated text cached on the server',
    env: 'TRANSLATION_CACHE_TTL_HOURS',
    unit: 'hours',
    default: 24,
    read: 'range',
    min: 1,
    max: 720,
    text: '{n}',
  },
  {
    key: 'data_exports',
    label: 'Data exports (subject access and portability downloads)',
    env: 'DATA_EXPORT_TTL_HOURS',
    unit: 'hours',
    default: 24,
    read: 'clamp',
    min: 1,
    max: 168,
    text: 'Deleted {n} after they are ready, or at once when the person they are about is erased',
  },
  {
    key: 'sign_in_codes',
    label: 'One-time sign-in codes',
    text: '5 minutes, removed about a day after they expire or are used',
  },
  {
    key: 'sessions',
    label: 'Signed-in sessions (device label, IP address, browser or app)',
    env: 'SESSION_IDLE_DAYS',
    unit: 'days',
    default: 30,
    read: 'atLeast',
    min: 1,
    text: 'End after {n} without use, or when you sign out',
  },
  {
    key: 'sessions_max',
    label: 'Longest a session can last',
    env: 'SESSION_MAX_AGE_DAYS',
    unit: 'days',
    default: 90,
    read: 'atLeast',
    min: 1,
    text: '{n} from sign-in',
  },
  {
    key: 'staff_sessions',
    label: 'Staff sessions (staff and school admin accounts)',
    env: 'STAFF_SESSION_IDLE_HOURS',
    unit: 'hours',
    default: 168,
    read: 'atLeast',
    min: 1,
    text: 'End after {n} without use',
    // Never longer than the general idle time (sessionPolicy).
    period: (n, env) =>
      `End after ${duration(Math.min(n, read(env, 'SESSION_IDLE_DAYS', 30, 'atLeast', 1) * 24), 'hours')} without use`,
  },
  {
    key: 'staff_sessions_max',
    label: 'Longest a staff session can last',
    env: 'STAFF_SESSION_MAX_DAYS',
    unit: 'days',
    default: 30,
    read: 'atLeast',
    min: 1,
    text: '{n} from sign-in',
    period: (n, env) =>
      `${duration(Math.min(n, read(env, 'SESSION_MAX_AGE_DAYS', 90, 'atLeast', 1)), 'days')} from sign-in`,
  },
  {
    key: 'known_devices',
    label: 'Devices you have signed in on (for new sign-in alerts)',
    text: '90 days without use',
  },
  {
    key: 'backups',
    label: 'Encrypted database backups',
    env: 'BACKUP_RETENTION_DAYS',
    unit: 'days',
    default: 30,
    read: 'atLeast',
    min: 1,
    text: '{n}; erased data can remain in a backup until it expires',
  },
  {
    key: 'erasure_log',
    label: 'Erasure log (identifiers only, so a restored backup can be erased again)',
    env: 'ERASURE_LOG_RETENTION_DAYS',
    unit: 'days',
    default: 400,
    read: 'clamp',
    min: 1,
    text: '{n}',
  },
];

/** envInt's rule: a whole number >= 0, else the default (0 is a real value). */
function readInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** The value the enforcing code ends up with, by its reading rule. */
function read(env: Env, name: string, fallback: number, how: Reader, min = 0, max = Infinity): number {
  switch (how) {
    case 'int':
      return readInt(env, name, fallback);
    case 'clamp':
      return Math.min(max, Math.max(min, readInt(env, name, fallback)));
    case 'range': {
      const n = Number(env[name]);
      return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
    }
    case 'atLeast': {
      const raw = env[name]?.trim();
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n >= min ? n : fallback;
    }
  }
}

function plural(n: number, unit: 'days' | 'hours'): string {
  const one = unit === 'days' ? 'day' : 'hour';
  return `${n} ${n === 1 ? one : unit}`;
}

/** Hours shown as whole days when they divide evenly ("168 hours" is "7 days"). */
function duration(n: number, unit: 'days' | 'hours'): string {
  if (unit === 'hours' && n >= 24 && n % 24 === 0) return plural(n / 24, 'days');
  return plural(n, unit);
}

/** The retention table for this install. */
export function retentionTable(env: Env = process.env): RetentionItem[] {
  return RETENTION.map((r) => {
    if (!r.env || !r.unit || r.default === undefined) {
      return { key: r.key, label: r.label, period: r.text };
    }
    const n = read(env, r.env, r.default, r.read ?? 'atLeast', r.min ?? (r.read === 'int' ? 0 : 1), r.max);
    const period = r.period
      ? r.period(n, env)
      : n === 0 && r.zero
        ? r.zero
        : r.text.replace('{n}', plural(n, r.unit));
    return { key: r.key, label: r.label, period, env: r.env };
  });
}

/** Resolves the organisation's choices over the defaults; unknown keys are dropped. */
export function lawfulBasesFor(
  overrides: Record<string, unknown> | null | undefined,
): { purpose: string; label: string; bases: { key: LawfulBasis; label: string }[]; isDefault: boolean }[] {
  return PURPOSES.map((p) => {
    const raw = overrides?.[p.key];
    const chosen = Array.isArray(raw)
      ? raw.filter((b): b is LawfulBasis => typeof b === 'string' && b in LAWFUL_BASES)
      : [];
    const keys = chosen.length > 0 ? [...new Set(chosen)] : p.defaults;
    return {
      purpose: p.key,
      label: p.label,
      bases: keys.map((key) => ({ key, label: LAWFUL_BASES[key] })),
      isDefault: chosen.length === 0,
    };
  });
}
