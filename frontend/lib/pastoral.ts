/**
 * Behaviour and pastoral notes (`/pastoral`, behind `pastoral_notes`): types
 * and small helpers for the staff pages. Never used by the student or parent
 * portal.
 */

export type PastoralKind =
  | "behaviour_positive"
  | "behaviour_concern"
  | "pastoral"
  | "safeguarding"
  | "medical"
  | "other";
export type PastoralSeverity = "low" | "medium" | "high";
export type PastoralStatus = "open" | "resolved";

export interface PastoralCategory {
  id: string;
  label: string;
  kind: PastoralKind;
  isSafeguarding: boolean;
  position: number;
  archived: boolean;
}

export interface PastoralNote {
  id: string;
  studentId: string;
  studentName: string | null;
  categoryId: string;
  categoryLabel: string;
  categoryKind: PastoralKind;
  isSafeguarding: boolean;
  severity: PastoralSeverity;
  occurredOn: string;
  body: string;
  followUpOn: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  status: PastoralStatus;
  resolvedAt: string | null;
  authorId: string | null;
  authorName: string | null;
  files: { id: string; name: string; contentType: string; sizeBytes: number }[];
  canEdit: boolean;
  canDelete: boolean;
  /** Withheld from subject access exports (data downloads) under an exemption. */
  sarWithheld?: boolean;
  sarWithheldReason?: string | null;
  sarWithheldAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PastoralAbilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canSafeguard: boolean;
  canManageSettings: boolean;
}

export const KIND_LABELS: Record<PastoralKind, string> = {
  behaviour_positive: "Behaviour (positive)",
  behaviour_concern: "Behaviour (concern)",
  pastoral: "Pastoral",
  safeguarding: "Safeguarding",
  medical: "Medical-related",
  other: "Other",
};

export const SEVERITY_LABELS: Record<PastoralSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export interface NoteFilters {
  categoryId?: string;
  status?: PastoralStatus | "";
  severity?: PastoralSeverity | "";
  from?: string;
  to?: string;
  studentId?: string;
}

/** Query string for list and export requests; empty filters are left out. */
export function notesQuery(f: NoteFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "string" && v.trim()) params.set(k, v.trim());
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "overdue", "today", "upcoming" or null for a note's follow-up. */
export function followUpState(
  note: Pick<PastoralNote, "followUpOn" | "status">,
  today = localToday(),
): "overdue" | "today" | "upcoming" | null {
  if (!note.followUpOn || note.status !== "open") return null;
  if (note.followUpOn < today) return "overdue";
  if (note.followUpOn === today) return "today";
  return "upcoming";
}

/** A YYYY-MM-DD date for display, without time-zone drift. */
export function formatDay(day: string | null): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString();
}

export interface NoteForm {
  categoryId: string;
  severity: PastoralSeverity;
  occurredOn: string;
  body: string;
  followUpOn: string;
  assignedTo: string;
  fileIds: string[];
}

export function emptyNoteForm(today = localToday()): NoteForm {
  return {
    categoryId: "",
    severity: "low",
    occurredOn: today,
    body: "",
    followUpOn: "",
    assignedTo: "",
    fileIds: [],
  };
}

export function noteFormOf(n: PastoralNote): NoteForm {
  return {
    categoryId: n.categoryId,
    severity: n.severity,
    occurredOn: n.occurredOn,
    body: n.body,
    followUpOn: n.followUpOn ?? "",
    assignedTo: n.assignedTo ?? "",
    fileIds: n.files.map((f) => f.id),
  };
}

/**
 * The request body for a form, or an error message. New notes leave empty
 * optional fields out; edits send null to clear them.
 */
export function noteRequest(
  f: NoteForm,
  editing: boolean,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!f.categoryId) return { ok: false, error: "Choose a category" };
  if (!f.occurredOn) return { ok: false, error: "Give the date it happened" };
  if (!f.body.trim()) return { ok: false, error: "Write the note" };
  if (f.followUpOn && f.followUpOn < f.occurredOn) {
    return { ok: false, error: "The follow-up date is before the note's date" };
  }
  const body: Record<string, unknown> = {
    categoryId: f.categoryId,
    severity: f.severity,
    occurredOn: f.occurredOn,
    body: f.body.trim(),
    fileIds: f.fileIds,
  };
  if (editing) {
    body.followUpOn = f.followUpOn || null;
    body.assignedTo = f.assignedTo || null;
  } else {
    if (f.followUpOn) body.followUpOn = f.followUpOn;
    if (f.assignedTo) body.assignedTo = f.assignedTo;
  }
  return { ok: true, body };
}

/**
 * Whether the caller may withhold a note from data requests (or release it):
 * they may change the note, and hold `pastoral-note:safeguarding` or
 * `student:export` (backend PastoralService.setSarWithheld).
 */
export function canWithholdNote(
  note: Pick<PastoralNote, "canEdit">,
  can: (resource: string, action: string) => boolean,
): boolean {
  return note.canEdit && (can("pastoral-note", "safeguarding") || can("student", "export"));
}

/** PATCH /pastoral/notes/:id/sar-withheld body; the reason is required to withhold. */
export function sarWithheldRequest(withheld: boolean, reason: string): { withheld: boolean; reason?: string } | null {
  if (!withheld) return { withheld: false };
  const r = reason.trim();
  return r ? { withheld: true, reason: r } : null;
}
