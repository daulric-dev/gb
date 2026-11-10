import { api, ApiError } from "@/lib/api";
import { ORGANISATION_PATH } from "@/lib/routing";
import { organisationSchoolPath } from "@/lib/organisation";

/**
 * Account deletion safeguards (backend src/auth/account-deletion.ts): the
 * blockers `GET /auth/account/deletion-check` lists and the 409
 * `ACCOUNT_DELETION_BLOCKED` that `DELETE /auth/account` answers with.
 */

export const ACCOUNT_DELETION_BLOCKED = "ACCOUNT_DELETION_BLOCKED";

export type DeletionBlockerCode =
  | "ORG_OWNER"
  | "LAST_ORG_ADMIN"
  | "SCHOOL_OWNER"
  | "SCHOOL_ADMIN"
  | "SSO_STUDENT";

export type DeletionBlockerAction =
  | { type: "transfer_organisation_ownership" }
  | { type: "add_organisation_admin" }
  | { type: "transfer_school_ownership"; schoolId: string; schoolName: string }
  | { type: "contact_school" };

export interface DeletionBlocker {
  code: DeletionBlockerCode | string;
  message: string;
  action?: DeletionBlockerAction;
}

export interface DeletionCheck {
  canDelete: boolean;
  blockers: DeletionBlocker[];
}

export function getDeletionCheck() {
  return api<DeletionCheck>("/auth/account/deletion-check");
}

/** The blockers carried by a 409 from `DELETE /auth/account`, or null. */
export function blockersFromError(err: unknown): DeletionBlocker[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (err.code !== ACCOUNT_DELETION_BLOCKED) return null;
  const blockers = (err.data as { blockers?: unknown } | undefined)?.blockers;
  if (!Array.isArray(blockers)) return null;
  return blockers.filter(
    (b): b is DeletionBlocker =>
      !!b && typeof b === "object" && typeof (b as DeletionBlocker).message === "string",
  );
}

/**
 * The account belongs to the school (a student signing in through school
 * SSO): no delete button at all, just the explanation.
 */
export function isSchoolManaged(blockers: DeletionBlocker[]): boolean {
  return blockers.some((b) => b.code === "SSO_STUDENT");
}

export interface BlockerContext {
  isOrgAdmin: boolean;
  activeSchoolId: string | null | undefined;
}

export interface BlockerLink {
  href: string;
  label: string;
}

/**
 * Where to go to clear a blocker on the web. A school is transferred from the
 * organisation console (organisation admins, any school) or from the
 * school's settings when it is the active school; otherwise pick it first.
 */
export function blockerLink(blocker: DeletionBlocker, ctx: BlockerContext): BlockerLink | null {
  const action = blocker.action;
  if (!action) return null;
  switch (action.type) {
    case "transfer_organisation_ownership":
      return { href: `${ORGANISATION_PATH}/settings#ownership`, label: "Transfer organisation" };
    case "add_organisation_admin":
      return { href: `${ORGANISATION_PATH}/admins`, label: "Add an administrator" };
    case "transfer_school_ownership":
      if (ctx.isOrgAdmin) {
        return {
          href: `${organisationSchoolPath(action.schoolId)}#ownership`,
          label: "Transfer school",
        };
      }
      if (ctx.activeSchoolId === action.schoolId) {
        return { href: "/dashboard/settings#ownership", label: "Transfer school" };
      }
      return { href: "/schools", label: `Switch to ${action.schoolName}` };
    default:
      return null;
  }
}
