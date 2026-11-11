import { api } from "@/lib/api";

/** One recipient of the privacy notice (backend src/privacy/privacy.recipients.ts). */
export interface NoticeRecipient {
  category:
    | "hosting"
    | "email"
    | "storage"
    | "backup"
    | "push"
    | "sso"
    | "ai"
    | "translation"
    | "webhook"
    | "lti"
    | "rostering";
  name: string;
  host: string | null;
  internal: boolean;
  purpose: string;
  location: string | null;
}

export interface NoticeLawfulBasis {
  purpose: string;
  label: string;
  bases: { key: string; label: string }[];
  isDefault: boolean;
}

export interface NoticeRetention {
  key: string;
  label: string;
  period: string;
  env?: string;
}

/** `GET /api/privacy/notice`. */
export interface PrivacyNotice {
  configured: boolean;
  missing: string[];
  recommended: string[];
  organisationName: string | null;
  controller: { name: string | null; address: string | null; privacyEmail: string | null };
  dpo: { name: string | null; email: string | null } | null;
  supervisoryAuthority: { name: string | null; url: string | null } | null;
  dataLocation: string | null;
  lawfulBases: NoticeLawfulBasis[];
  retention: NoticeRetention[];
  recipients: NoticeRecipient[];
  features: Record<string, boolean>;
  updatedAt: string | null;
}

/** The organisation console's editable fields (`GET/PUT /api/organisation/privacy`). */
export interface PrivacySettings {
  controllerName: string | null;
  controllerAddress: string | null;
  privacyEmail: string | null;
  dpoName: string | null;
  dpoEmail: string | null;
  supervisoryAuthorityName: string | null;
  supervisoryAuthorityUrl: string | null;
  dataLocation: string | null;
  lawfulBases: Record<string, string[]>;
  additionalRecipients: { name: string; purpose: string; location: string | null }[];
  updatedAt: string | null;
  missing: string[];
  recommended: string[];
}

export const FIELD_LABELS: Record<string, string> = {
  controllerName: "Controller name",
  controllerAddress: "Controller postal address",
  privacyEmail: "Privacy contact email",
  dpoName: "Data protection officer's name",
  dpoEmail: "Data protection officer's email",
  supervisoryAuthorityName: "Supervisory authority",
  supervisoryAuthorityUrl: "Supervisory authority website",
  dataLocation: "Where the data is hosted",
};

export const CATEGORY_LABELS: Record<NoticeRecipient["category"], string> = {
  hosting: "Hosting and infrastructure",
  email: "Email delivery",
  storage: "File storage",
  backup: "Backups",
  push: "Push notifications",
  sso: "Single sign-on",
  ai: "AI assistance",
  translation: "Translation",
  webhook: "Webhooks set up by schools",
  lti: "External tools (LTI)",
  rostering: "Rostering sources",
};

export function fetchPrivacyNotice(): Promise<PrivacyNotice> {
  return api<PrivacyNotice>("/privacy/notice", { skipAuthRedirect: true });
}

/** Who the controller is, for running text. */
export function controllerText(n: PrivacyNotice | null): string {
  return (
    n?.controller.name?.trim() ||
    n?.organisationName?.trim() ||
    "the organisation that runs this GradeBook"
  );
}

/** Who to contact, for running text. */
export function contactText(n: PrivacyNotice | null): string {
  if (n?.controller.privacyEmail) return n.controller.privacyEmail;
  if (n?.dpo?.email) return n.dpo.email;
  return "your school office";
}

/** The location check-in period from the retention table, for running text. */
export function locationRetentionText(n: PrivacyNotice | null): string {
  const row = n?.retention.find((r) => r.key === "attendance_location");
  const m = row?.period.match(/\d+ (?:hours?|days?)/);
  return m?.[0] ?? "24 hours";
}

/** Fills `{{controller}}`, `{{contact}}` and `{{locationRetention}}`. */
export function fill(text: string, n: PrivacyNotice | null): string {
  return text
    .replaceAll("{{controller}}", controllerText(n))
    .replaceAll("{{contact}}", contactText(n))
    .replaceAll("{{locationRetention}}", locationRetentionText(n));
}
