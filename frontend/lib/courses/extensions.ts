import { formatDue, toLocalInput } from "./format";

/** The body of PUT /activities/:activityId/extensions/:studentId. */
export interface ExtensionRequest {
  dueAt: string;
  reason?: string;
}

/**
 * Check what a teacher typed into the extension dialog: a local date and
 * time from a datetime-local input, which must be in the future, and an
 * optional reason. The server checks the same.
 */
export function extensionRequest(
  localDueAt: string,
  reason: string,
  now: number = Date.now(),
): { ok: true; body: ExtensionRequest } | { ok: false; error: string } {
  if (!localDueAt.trim()) return { ok: false, error: "Choose a new due date" };
  const due = new Date(localDueAt);
  if (Number.isNaN(due.getTime())) {
    return { ok: false, error: "Choose a valid due date" };
  }
  if (due.getTime() <= now) {
    return { ok: false, error: "The new due date must be in the future" };
  }
  const trimmed = reason.trim();
  if (trimmed.length > 500) {
    return { ok: false, error: "Keep the reason under 500 characters" };
  }
  return {
    ok: true,
    body: { dueAt: due.toISOString(), ...(trimmed ? { reason: trimmed } : {}) },
  };
}

/**
 * Where the dialog's date starts: the student's current extension, else a
 * day after the later of the due date and now.
 */
export function suggestedExtensionInput(
  currentExtension: string | null | undefined,
  activityDueAt: string | null,
  now: number = Date.now(),
): string {
  if (currentExtension) return toLocalInput(currentExtension);
  const due = activityDueAt ? Date.parse(activityDueAt) : NaN;
  const from = Number.isFinite(due) ? Math.max(due, now) : now;
  return toLocalInput(new Date(from + 86_400_000).toISOString());
}

/** The roster badge, e.g. "Extended to Nov 12, 5:00 PM". */
export function extendedLabel(dueAt: string): string {
  return `Extended to ${formatDue(dueAt)}`;
}
