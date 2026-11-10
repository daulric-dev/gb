/**
 * Behaviour and pastoral notes (feature `pastoral_notes`) for staff: the
 * shapes the API returns and the paths the quick-note screen uses. Never used
 * by the student or parent tabs.
 */

export type PastoralSeverity = "low" | "medium" | "high";

export interface PastoralAbilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canSafeguard: boolean;
  canManageSettings: boolean;
}

export interface PastoralCategory {
  id: string;
  label: string;
  kind: string;
  isSafeguarding: boolean;
  archived: boolean;
}

export interface PastoralNote {
  id: string;
  categoryLabel: string;
  isSafeguarding: boolean;
  severity: PastoralSeverity;
  occurredOn: string;
  body: string;
  followUpOn: string | null;
  assignedToName: string | null;
  status: "open" | "resolved";
  authorName: string | null;
}

export const SEVERITIES: { value: PastoralSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const pastoralPaths = {
  me: "/pastoral/me",
  categories: "/pastoral/categories",
  notes: (studentId: string) => `/pastoral/students/${studentId}/notes`,
};

/** Today's date on this device, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Whether these abilities may open the timeline at all. */
export const mayUsePastoral = (a: PastoralAbilities | null) =>
  !!a && (a.canRead || a.canCreate || a.canUpdate);
