import { api, ApiError } from "@/lib/api";
import { ORGANISATION_PATH } from "@/lib/routing";

/** Shapes of the organisation-admin API (`/api/organisation/*`). */

export interface Organisation {
  id: string;
  name: string;
  createdAt: string;
}

export interface OrganisationOverview {
  schools: number;
  activeSchools: number;
  staff: number;
  students: number;
}

export interface OrganisationAdmin {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  /** Listed in the server's environment: cannot be removed from the app. */
  fromEnv: boolean;
}

export type SchoolType =
  | "preschool"
  | "primary"
  | "middle"
  | "secondary"
  | "all_through"
  | "sixth_form"
  | "college"
  | "university"
  | "vocational"
  | "special_education"
  | "online"
  | "other";

export const SCHOOL_TYPES: { value: SchoolType; label: string }[] = [
  { value: "preschool", label: "Preschool / early years" },
  { value: "primary", label: "Primary" },
  { value: "middle", label: "Middle" },
  { value: "secondary", label: "Secondary" },
  { value: "all_through", label: "All-through (K-12)" },
  { value: "sixth_form", label: "Sixth form" },
  { value: "college", label: "College" },
  { value: "university", label: "University" },
  { value: "vocational", label: "Vocational / technical" },
  { value: "special_education", label: "Special education" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

export interface OrganisationSchoolAdmin {
  userId: string;
  email: string;
  name: string | null;
}

export interface OrganisationSchool {
  id: string;
  name: string;
  code: string | null;
  schoolType: string | null;
  isActive: boolean;
  createdAt: string;
  admin: OrganisationSchoolAdmin | null;
  staffCount: number;
  studentCount: number;
  /** The open admin invite, while the school has no admin (may be expired). */
  pendingAdminInvite: InviteSummary | null;
}

/** An invite for an email with no account yet (`/api/organisation/invites`). */
export interface InviteSummary {
  id: string;
  email: string;
  expiresAt: string;
}

export type InviteKind = "school_admin" | "organisation_admin";

/** GET /organisation/invites?kind=. */
export interface OrganisationInvite extends InviteSummary {
  kind: InviteKind;
  school: { id: string; name: string } | null;
  invitedBy: { userId: string; email: string; name: string | null } | null;
  createdAt: string;
  expired: boolean;
}

/** POST /organisation/schools, PUT /organisation/schools/:id/admin. */
export type AppointedSchool = OrganisationSchool & { invited: InviteSummary | null };

/** POST /organisation/admins: the new admin's row, or the invite sent instead. */
export type AddedAdmin =
  | (OrganisationAdmin & { invited: null })
  | { invited: InviteSummary };

/** GET /organisation/schools/:id: the list row plus the school's logo. */
export interface OrganisationSchoolDetail extends OrganisationSchool {
  logoUrl: string | null;
}

/**
 * Where the school settings cards send their requests: the active school's
 * own routes (school:update), or one school's routes in the organisation
 * console (organisation admins, any school).
 */
export const CURRENT_SCHOOL_API = "/schools/current";

/** API base for one school's settings as an organisation admin. */
export function organisationSchoolApi(schoolId: string): string {
  return `/organisation/schools/${encodeURIComponent(schoolId)}`;
}

/** The console page for one school. */
export function organisationSchoolPath(schoolId: string): string {
  return `${ORGANISATION_PATH}/schools/${encodeURIComponent(schoolId)}`;
}

export type SchoolStatusFilter = "active" | "inactive" | "all";

/** Query string for GET /organisation/schools; empty parts are left out. */
export function schoolsQuery(search: string, status: SchoolStatusFilter): string {
  const params = new URLSearchParams();
  const q = search.trim();
  if (q) params.set("search", q);
  if (status !== "all") params.set("status", status);
  const qs = params.toString();
  return `/organisation/schools${qs ? `?${qs}` : ""}`;
}

export function schoolTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return SCHOOL_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** "Name (email)", or just the email when there is no name. */
export function personLabel(p: { name: string | null; email: string }): string {
  return p.name ? `${p.name} (${p.email})` : p.email;
}

/** An ApiError's message, or a fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/** POST /organisation/users/:userId/sessions/revoke. */
export function revokeUserSessions(userId: string) {
  return api<{ revoked?: number } | null>(
    `/organisation/users/${encodeURIComponent(userId)}/sessions/revoke`,
    { method: "POST" },
  );
}

/** Toast copy for a finished session revoke. */
export function revokedMessage(who: string, revoked: number | undefined): string {
  if (typeof revoked !== "number") return `Signed ${who} out of every device.`;
  return revoked === 0
    ? `${who} was not signed in anywhere.`
    : `Signed ${who} out of ${revoked} device${revoked === 1 ? "" : "s"}.`;
}

/** GET /organisation/invites, optionally of one kind. */
export function invitesPath(kind?: InviteKind): string {
  return `/organisation/invites${kind ? `?kind=${kind}` : ""}`;
}

/** DELETE /organisation/invites/:id. */
export function revokeInvite(id: string) {
  return api<{ revoked: boolean }>(`/organisation/invites/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** POST /organisation/invites/:id/resend: 14 more days, emailed again. */
export function resendInvite(id: string) {
  return api<InviteSummary>(`/organisation/invites/${encodeURIComponent(id)}/resend`, {
    method: "POST",
  });
}

/** Whether an invite's expiry has passed (`now` for tests). */
export function inviteExpired(invite: { expiresAt: string }, now = Date.now()): boolean {
  return new Date(invite.expiresAt).getTime() <= now;
}

/** "expires 15 Nov 2026" / "expired 1 Nov 2026". */
export function inviteExpiryLabel(invite: { expiresAt: string }, now = Date.now()): string {
  const date = new Date(invite.expiresAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${inviteExpired(invite, now) ? "expired" : "expires"} ${date}`;
}

/**
 * Toast copy after appointing a school's admin, or adding an organisation
 * admin: invited (no account yet) or appointed straight away.
 */
export function appointedMessage(
  result: { invited: InviteSummary | null } | null | undefined,
  email: string,
  role: string,
): string {
  if (result?.invited) {
    return `Invited ${result.invited.email} — they'll become ${role} when they first sign in`;
  }
  return `Appointed ${email} as ${role}`;
}
