/** Wire types for school email domains (see backend `email-domain` module). */

/** "any": students and staff share the domain (e.g. everyone @srmss.edu.gd). */
export type EmailDomainAudience = "student" | "staff" | "any";
export type EmailDomainStaffRole = "teacher" | "member";

export interface EmailDomain {
  id: string;
  domain: string;
  audience: EmailDomainAudience;
  autoJoin: boolean;
  staffRole: EmailDomainStaffRole;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  dnsRecord: { type: "TXT"; name: string; value: string };
  /** Sign-in provider id (from GET /auth/sso/providers); null: email codes. */
  ssoProvider: string | null;
  /** Email codes are refused for the domain; only ssoProvider works. */
  ssoRequired: boolean;
  /** Microsoft Entra tenant whose sign-ins may join (provider "azure"). */
  azureTenantId: string | null;
  /** SAML (provider "saml"): the IdP's single sign-on URL (https). */
  samlEntryPoint: string | null;
  /** SAML: the IdP's entity ID, checked as the response issuer. */
  samlIssuer: string | null;
  /** SAML: the IdP's signing certificate (PEM). */
  samlCertificate: string | null;
}

export interface DomainMatch {
  domainId: string;
  domain: string;
  schoolId: string;
  schoolName: string;
  /** Resolved for the signed-in user: never "any". */
  audience: "student" | "staff";
  autoJoin: boolean;
}

export type DomainJoinResult =
  | { status: "joined"; schoolId: string; audience: "student" | "staff" }
  | { status: "requested"; schoolId: string };

/** What happens to a staff member signing in with this domain. */
export function staffBehaviour(
  d: Pick<EmailDomain, "audience" | "autoJoin" | "staffRole">,
): string | null {
  if (d.audience === "student") return null;
  const prefix = d.audience === "any" ? "Staff: " : "";
  if (!d.autoJoin) return `${prefix}Needs approval`;
  return `${prefix}${d.staffRole === "member" ? "Joins as Member" : "Joins as Teacher"}`;
}

export const AUDIENCE_LABEL: Record<EmailDomainAudience, string> = {
  student: "Students",
  staff: "Staff",
  any: "Students and staff",
};
