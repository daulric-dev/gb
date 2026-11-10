/**
 * Account deletion safeguards (backend src/auth/account-deletion.ts), as the
 * web's lib/account-deletion.ts. Ownership transfers are on the web; the app
 * explains what to do there. Pure (no React Native imports) so bun can
 * test it; the screen calls GET /auth/account/deletion-check itself.
 */

export const ACCOUNT_DELETION_BLOCKED = "ACCOUNT_DELETION_BLOCKED";

export interface DeletionBlocker {
  /** ORG_OWNER | LAST_ORG_ADMIN | SCHOOL_OWNER | SCHOOL_ADMIN | SSO_STUDENT */
  code: string;
  message: string;
  action?: { type: string; schoolId?: string; schoolName?: string };
}

export interface DeletionCheck {
  canDelete: boolean;
  blockers: DeletionBlocker[];
}

export const DELETION_CHECK_PATH = "/auth/account/deletion-check";

/** The blockers of a 409 from DELETE /auth/account, or null. */
export function blockersFromError(err: unknown): DeletionBlocker[] | null {
  // An ApiError (lib/api.ts), read by shape.
  const e = err as { status?: unknown; data?: unknown } | null;
  if (!e || typeof e !== "object" || e.status !== 409) return null;
  const data = e.data as { code?: unknown; blockers?: unknown } | undefined;
  if (data?.code !== ACCOUNT_DELETION_BLOCKED) return null;
  const blockers = data.blockers;
  if (!Array.isArray(blockers)) return null;
  return blockers.filter(
    (b): b is DeletionBlocker =>
      !!b && typeof b === "object" && typeof (b as DeletionBlocker).message === "string",
  );
}

/** A student account run by the school's sign-in: no delete button. */
export function isSchoolManaged(blockers: DeletionBlocker[]): boolean {
  return blockers.some((b) => b.code === "SSO_STUDENT");
}

/** What to do about a blocker in the app: transfers happen on the web. */
export function blockerHint(blocker: DeletionBlocker): string | null {
  switch (blocker.action?.type) {
    case "transfer_organisation_ownership":
      return "On the web: Organisation → Settings → Ownership.";
    case "add_organisation_admin":
      return "On the web: Organisation → Administrators.";
    case "transfer_school_ownership":
      return "On the web: the school's Settings → School ownership.";
    default:
      return null;
  }
}
