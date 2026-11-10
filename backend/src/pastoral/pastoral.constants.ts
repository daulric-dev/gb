/** The built-in kinds a school's categories belong to. */
export const PASTORAL_KINDS = [
  'behaviour_positive',
  'behaviour_concern',
  'pastoral',
  'safeguarding',
  'medical',
  'other',
] as const;
export type PastoralKind = (typeof PASTORAL_KINDS)[number];

export const PASTORAL_SEVERITIES = ['low', 'medium', 'high'] as const;
export type PastoralSeverity = (typeof PASTORAL_SEVERITIES)[number];

export const PASTORAL_STATUSES = ['open', 'resolved'] as const;
export type PastoralStatus = (typeof PASTORAL_STATUSES)[number];

/** Categories a school starts with (created the first time it lists them). */
export const DEFAULT_CATEGORIES: { label: string; kind: PastoralKind; safeguarding: boolean }[] = [
  { label: 'Behaviour (positive)', kind: 'behaviour_positive', safeguarding: false },
  { label: 'Behaviour (concern)', kind: 'behaviour_concern', safeguarding: false },
  { label: 'Pastoral', kind: 'pastoral', safeguarding: false },
  { label: 'Safeguarding', kind: 'safeguarding', safeguarding: true },
  { label: 'Medical-related', kind: 'medical', safeguarding: false },
  { label: 'Other', kind: 'other', safeguarding: false },
];

/** Most attachments on one note. */
export const MAX_NOTE_FILES = 10;
/** Most notes one list or export returns. */
export const MAX_NOTES = 500;
