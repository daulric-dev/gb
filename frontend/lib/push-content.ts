import { api } from "@/lib/api";

/**
 * What a push notification shows on the lock screen (backend
 * src/notifications/push-content.ts). Set by the organisation, overridden
 * per school; unset on both, notices about children are generic and course
 * news is full.
 */
export type PushContent = "full" | "generic";

export interface PushContentView {
  /** This scope's own value; null = not set. */
  value: PushContent | null;
  /** School view: the organisation's value. */
  organisation?: PushContent | null;
}

export type PushContentScope = "school" | "organisation";

export function pushContentPath(scope: PushContentScope): string {
  return scope === "school" ? "/notifications/push-content" : "/notifications/organisation/push-content";
}

export const getPushContent = (scope: PushContentScope) => api<PushContentView>(pushContentPath(scope));

export const setPushContent = (scope: PushContentScope, pushContent: PushContent | null) =>
  api<PushContentView>(pushContentPath(scope), { method: "PUT", body: { pushContent } });

/** The select's value: "unset" stands for null. */
export type PushContentChoice = PushContent | "unset";

export const toChoice = (value: PushContent | null | undefined): PushContentChoice => value ?? "unset";
export const fromChoice = (choice: string): PushContent | null =>
  choice === "full" || choice === "generic" ? choice : null;

export const DEFAULT_PUSH_TEXT =
  "Notices about children (attendance, grades, parent notices) are generic; course news (new work, announcements) shows in full.";

export const PUSH_CONTENT_LABELS: Record<PushContent, string> = {
  full: "Full content",
  generic: "Generic (“You have a new update”)",
};

/** What actually applies, for the line under the selector. */
export function effectivePushText(view: PushContentView, scope: PushContentScope): string {
  if (view.value) return `${PUSH_CONTENT_LABELS[view.value]} for every notification.`;
  if (scope === "school" && view.organisation) {
    return `Follows the organisation: ${PUSH_CONTENT_LABELS[view.organisation].toLowerCase()} for every notification.`;
  }
  return `Default: ${DEFAULT_PUSH_TEXT}`;
}

/** The label of the "not set" option. */
export function unsetLabel(view: PushContentView | null, scope: PushContentScope): string {
  if (scope === "school") {
    return view?.organisation
      ? `Follow the organisation (${PUSH_CONTENT_LABELS[view.organisation].toLowerCase()})`
      : "Follow the organisation (default)";
  }
  return "Default (children's notices generic, course news full)";
}
