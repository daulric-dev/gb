import { api } from "@/lib/api";

/**
 * Erasing a student record for good (backend src/erasure,
 * `DELETE /students/:id`, `student:erase`, step-up).
 */

/** What happens to the account linked to the record. */
export type LinkedAccountOutcome = "none" | "deleted" | "unlinked";

export const getErasurePreview = (studentId: string) =>
  api<{ account: LinkedAccountOutcome }>(`/students/${encodeURIComponent(studentId)}/erasure-preview`);

export const eraseStudent = (studentId: string) =>
  api<{ studentId: string; account: LinkedAccountOutcome; reportFiles: number }>(
    `/students/${encodeURIComponent(studentId)}`,
    { method: "DELETE", stepUp: true },
  );

/** What erasing deletes (the backend's StudentErasureService). */
export const ERASED_ITEMS = [
  "The student record and its details",
  "Enrolments, submissions, quiz answers, rubric marks, similarity fingerprints and peer reviews",
  "Attendance records and alerts",
  "Extensions and accommodations",
  "Report comments and report cards (their PDFs too)",
  "Pastoral notes",
  "Parent links and invitations",
  "Learning-outcome (mastery) evidence and analytics",
  "Rostering links that name the student",
] as const;

export const KEPT_ITEMS = [
  "Audit-log entries about the student (kept for the organisation's retention period)",
  "Files staff attached to pastoral notes (they stay in that staff member's files)",
] as const;

export function accountOutcomeText(outcome: LinkedAccountOutcome): string {
  switch (outcome) {
    case "none":
      return "No sign-in account is linked to this record.";
    case "deleted":
      return "The linked sign-in account is managed by the school and is used only here, so it is deleted too.";
    case "unlinked":
      return "The linked sign-in account belongs to the student (or is used in another school). It is kept, removed from this school, and the discussion posts they wrote stay.";
  }
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The text to type to confirm: the student's name, or ERASE when it has none. */
export function eraseConfirmWord(name: string): string {
  return norm(name) ? name.trim().replace(/\s+/g, " ") : "ERASE";
}

export function eraseConfirmMatches(input: string, name: string): boolean {
  const want = norm(eraseConfirmWord(name));
  return want.length > 0 && norm(input) === want;
}
