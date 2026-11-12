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

interface RetentionDefinition {
  key: string;
  label: string;
  env?: string;
  unit?: 'days' | 'hours';
  default?: number;
  /** Fixed text, or a template where `{n}` is the configured number. */
  text: string;
}

/**
 * Retention rows. `env` + `default` must match the code that enforces the
 * period (src/retention, src/account/session.config.ts, ...); the notice
 * reads the same variables so it states what this install does.
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
    text: 'Hidden at once, erased for good after {n}',
  },
  {
    key: 'attendance_location',
    label: 'Location coordinates from attendance check-ins',
    env: 'ATTENDANCE_LOCATION_RETENTION_HOURS',
    unit: 'hours',
    default: 24,
    text: 'Used for the distance check and cleared within {n}; only the distance is kept',
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
    text: '{n}',
  },
  {
    key: 'audit_log',
    label: 'Audit logs (school records, sign-in and integrations)',
    env: 'AUDIT_LOG_RETENTION_DAYS',
    unit: 'days',
    default: 730,
    text: '{n}',
  },
  {
    key: 'roster_history',
    label: 'Rostering run history',
    env: 'ROSTER_HISTORY_RETENTION_DAYS',
    unit: 'days',
    default: 90,
    text: '{n}',
  },
  {
    key: 'webhook_deliveries',
    label: 'Webhook delivery records (the data sent to a school\'s webhook)',
    env: 'WEBHOOK_DELIVERY_RETENTION_DAYS',
    unit: 'days',
    default: 30,
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
    text: '{n}',
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
    text: 'End after {n} without use, or when you sign out',
  },
  {
    key: 'sessions_max',
    label: 'Longest a session can last',
    env: 'SESSION_MAX_AGE_DAYS',
    unit: 'days',
    default: 90,
    text: '{n} from sign-in',
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
    text: '{n}; erased data can remain in a backup until it expires',
  },
  {
    key: 'erasure_log',
    label: 'Erasure log (identifiers only, so a restored backup can be erased again)',
    env: 'ERASURE_LOG_RETENTION_DAYS',
    unit: 'days',
    default: 400,
    text: '{n}',
  },
];

/** A positive whole number from the environment, else the default. */
function configured(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function plural(n: number, unit: 'days' | 'hours'): string {
  const one = unit === 'days' ? 'day' : 'hour';
  return `${n} ${n === 1 ? one : unit}`;
}

/** The retention table for this install. */
export function retentionTable(env: Env = process.env): RetentionItem[] {
  return RETENTION.map((r) => {
    if (!r.env || !r.unit || r.default === undefined) {
      return { key: r.key, label: r.label, period: r.text };
    }
    const n = configured(env, r.env, r.default);
    return {
      key: r.key,
      label: r.label,
      period: r.text.replace('{n}', plural(n, r.unit)),
      env: r.env,
    };
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
