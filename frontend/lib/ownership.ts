import { api } from "@/lib/api";
import type { OrganisationAdmin } from "@/lib/organisation";

/**
 * Handing over the organisation or a school (backend
 * src/organisation/ownership.service.ts). Owners must do this before they can
 * delete their account. Both transfers need a recent step-up, which `api`
 * asks for (`stepUp: true`).
 */

export interface OwnerSummary {
  userId: string;
  name: string;
  email: string;
}

export interface SchoolTransferCandidate extends OwnerSummary {
  role: string | null;
}

/** GET /schools/:schoolId/transfer-ownership/candidates. */
export interface SchoolTransferInfo {
  schoolId: string;
  schoolName: string;
  owner: OwnerSummary | null;
  candidates: SchoolTransferCandidate[];
}

export function transferOrganisationOwnership(userId: string) {
  return api<{ ownerId: string; owner: OwnerSummary }>("/organisation/transfer-ownership", {
    method: "POST",
    body: { userId },
    stepUp: true,
  });
}

export function schoolTransferPath(schoolId: string): string {
  return `/schools/${encodeURIComponent(schoolId)}/transfer-ownership`;
}

export function getSchoolTransferInfo(schoolId: string) {
  return api<SchoolTransferInfo>(`${schoolTransferPath(schoolId)}/candidates`);
}

export function transferSchoolOwnership(schoolId: string, userId: string) {
  return api<{ schoolId: string; ownerId: string; owner: OwnerSummary }>(
    schoolTransferPath(schoolId),
    { method: "POST", body: { userId }, stepUp: true },
  );
}

/**
 * Who the organisation can be handed to: stored admins other than the owner.
 * Admins only listed in ORG_ADMIN_EMAILS have no row to own it with.
 */
export function organisationTransferTargets(
  admins: OrganisationAdmin[],
  ownerId: string | null | undefined,
): OrganisationAdmin[] {
  return admins.filter((a) => a.stored !== false && !a.isOwner && a.userId !== ownerId);
}

/**
 * Whether this user may hand the organisation over: its owner, or any
 * organisation admin while it has none.
 */
export function canTransferOrganisation(
  ownerId: string | null | undefined,
  userId: string | null | undefined,
  isOrgAdmin: boolean,
): boolean {
  if (!userId) return false;
  return ownerId ? ownerId === userId : isOrgAdmin;
}

/** "Ada Lovelace (ada@x.org)", or the email alone. */
export function ownerLabel(p: { name?: string | null; email: string }): string {
  const name = p.name?.trim();
  return name ? `${name} (${p.email})` : p.email;
}

/** The toast after a school changes hands. */
export function schoolTransferredMessage(schoolName: string, to: { name?: string | null; email: string }) {
  const who = to.name?.trim() || to.email;
  return `${who} now owns ${schoolName || "the school"} and is its administrator. The previous administrator stays on as a teacher.`;
}
