/**
 * LTI 1.3 external tools (backend `src/lti`): the organisation's tool
 * registry and platform keys, external tool items in course modules, and
 * launching one.
 */
import { ApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";

// ── Organisation registry ────────────────────────────────────────────────────

export const ORGANISATION_LTI_API = "/organisation/lti";

export interface LtiPlatformKey {
  kid: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
}

/** What a tool is configured with on its side ("values to give the tool"). */
export interface LtiPlatform {
  issuer: string;
  authUrl: string;
  jwksUrl: string;
  tokenUrl: string;
  keys: LtiPlatformKey[];
}

export interface LtiDeployment {
  id: string;
  deploymentId: string;
  /** null = every school. */
  schoolId: string | null;
  schoolName: string | null;
}

export interface LtiTool {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  loginUrl: string;
  targetLinkUri: string;
  redirectUris: string[];
  jwksUrl: string | null;
  publicKeyPem: string | null;
  agsEnabled: boolean;
  sendName: boolean;
  sendEmail: boolean;
  customParams: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deployments: LtiDeployment[];
  /** Course module items that link to the tool. */
  linkCount: number;
}

/** GET /organisation/lti. */
export interface LtiOverview {
  platform: LtiPlatform;
  tools: LtiTool[];
}

export function ltiToolApi(toolId: string): string {
  return `${ORGANISATION_LTI_API}/tools/${encodeURIComponent(toolId)}`;
}

/** Where a deployment applies, for display. */
export function deploymentLabel(d: LtiDeployment): string {
  return d.schoolId === null ? "Every school" : (d.schoolName ?? "A school");
}

// ── Custom parameters and line lists ─────────────────────────────────────────

const CUSTOM_KEY = /^[A-Za-z0-9_]{1,64}$/;
export const MAX_CUSTOM_PARAMS = 50;
export const MAX_CUSTOM_VALUE = 1024;

/** Non-empty trimmed lines. */
export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * `key=value` lines into custom parameters (blank lines skipped, the value is
 * everything after the first `=`), or the reason they cannot be used (the
 * API's rules: letters, digits and _ in names, at most 50, 1024 characters
 * a value).
 */
export function parseCustomParams(
  text: string,
): { params: Record<string, string>; problem: null } | { params: null; problem: string } {
  const params: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const eq = line.indexOf("=");
    if (eq < 0) return { params: null, problem: `"${line.slice(0, 40)}" needs a name=value` };
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!CUSTOM_KEY.test(key)) {
      return {
        params: null,
        problem: `Custom parameter names use letters, digits and _ only ("${key.slice(0, 40)}")`,
      };
    }
    if (value.length > MAX_CUSTOM_VALUE) {
      return { params: null, problem: `"${key}" is longer than ${MAX_CUSTOM_VALUE} characters` };
    }
    params[key] = value;
  }
  if (Object.keys(params).length > MAX_CUSTOM_PARAMS) {
    return { params: null, problem: `At most ${MAX_CUSTOM_PARAMS} custom parameters` };
  }
  return { params, problem: null };
}

/** Custom parameters as `key=value` lines, for editing. */
export function formatCustomParams(params: Record<string, string> | null | undefined): string {
  return Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
}

/** An http(s) URL without credentials or a fragment, or the problem with it. */
export function toolUrlProblem(value: string, label: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return `${label}: enter a full address, starting with https://`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `${label} must use https`;
  if (url.username || url.password) return `${label} must not contain a user name or password`;
  if (url.hash) return `${label} must not contain a #fragment`;
  return null;
}

// ── Register / edit form ─────────────────────────────────────────────────────

export type ToolKeyMode = "jwks" | "pem";

export interface ToolDraft {
  name: string;
  description: string;
  loginUrl: string;
  targetLinkUri: string;
  /** One per line. */
  redirectUris: string;
  keyMode: ToolKeyMode;
  jwksUrl: string;
  publicKeyPem: string;
  agsEnabled: boolean;
  sendName: boolean;
  sendEmail: boolean;
  /** `key=value` lines. */
  customParams: string;
  enabled: boolean;
  /** New tools only: every school, or the chosen ones. */
  allSchools: boolean;
  schoolIds: string[];
}

export function toolDraftOf(t: LtiTool | null): ToolDraft {
  return {
    name: t?.name ?? "",
    description: t?.description ?? "",
    loginUrl: t?.loginUrl ?? "",
    targetLinkUri: t?.targetLinkUri ?? "",
    redirectUris: (t?.redirectUris ?? []).join("\n"),
    keyMode: t && !t.jwksUrl && t.publicKeyPem ? "pem" : "jwks",
    jwksUrl: t?.jwksUrl ?? "",
    publicKeyPem: t?.publicKeyPem ?? "",
    agsEnabled: t?.agsEnabled ?? false,
    sendName: t?.sendName ?? false,
    sendEmail: t?.sendEmail ?? false,
    customParams: formatCustomParams(t?.customParams),
    enabled: t?.enabled ?? true,
    allSchools: true,
    schoolIds: [],
  };
}

/** Why the draft cannot be saved, or null. */
export function toolDraftProblem(d: ToolDraft): string | null {
  if (!d.name.trim()) return "Give the tool a name";
  const login = toolUrlProblem(d.loginUrl, "Login initiation URL");
  if (login) return login;
  const launch = toolUrlProblem(d.targetLinkUri, "Launch URL");
  if (launch) return launch;
  const redirects = parseLines(d.redirectUris);
  if (redirects.length === 0) return "Add at least one redirect URL";
  if (redirects.length > 20) return "At most 20 redirect URLs";
  for (const r of redirects) {
    const p = toolUrlProblem(r, "Redirect URL");
    if (p) return p;
  }
  if (d.keyMode === "jwks") {
    const jwks = toolUrlProblem(d.jwksUrl, "JWKS URL");
    if (jwks) return jwks;
  } else if (!/-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(d.publicKeyPem)) {
    return "Paste the tool's public key in PEM format (-----BEGIN PUBLIC KEY-----)";
  }
  const custom = parseCustomParams(d.customParams);
  if (custom.problem) return custom.problem;
  if (!d.allSchools && d.schoolIds.length === 0) return "Choose at least one school";
  return null;
}

export interface ToolBody {
  name?: string;
  description?: string | null;
  loginUrl?: string;
  targetLinkUri?: string;
  redirectUris?: string[];
  jwksUrl?: string | null;
  publicKeyPem?: string | null;
  agsEnabled?: boolean;
  sendName?: boolean;
  sendEmail?: boolean;
  enabled?: boolean;
  customParams?: Record<string, string>;
  schoolIds?: string[];
}

/** POST /organisation/lti/tools body (call after `toolDraftProblem` is null). */
export function toolCreateBody(d: ToolDraft): ToolBody {
  const body: ToolBody = {
    name: d.name.trim(),
    loginUrl: d.loginUrl.trim(),
    targetLinkUri: d.targetLinkUri.trim(),
    redirectUris: parseLines(d.redirectUris),
    agsEnabled: d.agsEnabled,
    sendName: d.sendName,
    sendEmail: d.sendEmail,
    enabled: d.enabled,
    customParams: parseCustomParams(d.customParams).params ?? {},
  };
  if (d.description.trim()) body.description = d.description.trim();
  if (d.keyMode === "jwks") body.jwksUrl = d.jwksUrl.trim();
  else body.publicKeyPem = d.publicKeyPem.trim();
  if (!d.allSchools) body.schoolIds = [...new Set(d.schoolIds)];
  return body;
}

/** PATCH body with only what changed, or null when nothing did. */
export function toolPatch(t: LtiTool, d: ToolDraft): ToolBody | null {
  const out: ToolBody = {};
  if (d.name.trim() !== t.name) out.name = d.name.trim();
  const description = d.description.trim() || null;
  if (description !== (t.description ?? null)) out.description = description;
  if (d.loginUrl.trim() !== t.loginUrl) out.loginUrl = d.loginUrl.trim();
  if (d.targetLinkUri.trim() !== t.targetLinkUri) out.targetLinkUri = d.targetLinkUri.trim();
  const redirects = parseLines(d.redirectUris);
  if (redirects.join("\n") !== t.redirectUris.join("\n")) out.redirectUris = redirects;
  if (d.keyMode === "jwks") {
    if (d.jwksUrl.trim() !== (t.jwksUrl ?? "")) out.jwksUrl = d.jwksUrl.trim();
    if (t.publicKeyPem) out.publicKeyPem = null;
  } else {
    if (d.publicKeyPem.trim() !== (t.publicKeyPem ?? "").trim()) out.publicKeyPem = d.publicKeyPem.trim();
    if (t.jwksUrl) out.jwksUrl = null;
  }
  if (d.agsEnabled !== t.agsEnabled) out.agsEnabled = d.agsEnabled;
  if (d.sendName !== t.sendName) out.sendName = d.sendName;
  if (d.sendEmail !== t.sendEmail) out.sendEmail = d.sendEmail;
  if (d.enabled !== t.enabled) out.enabled = d.enabled;
  const custom = parseCustomParams(d.customParams).params ?? {};
  if (!sameParams(custom, t.customParams ?? {})) out.customParams = custom;
  return Object.keys(out).length ? out : null;
}

// ── Course items and launches ────────────────────────────────────────────────

/** GET /courses/:courseId/lti/tools. */
export interface CourseLtiTool {
  id: string;
  name: string;
  description: string | null;
  agsEnabled: boolean;
}

/** GET/PATCH /courses/:courseId/lti/items/:itemId. */
export interface LtiItemDetail {
  resourceLinkId: string;
  toolId: string;
  toolName: string;
  toolEnabled: boolean;
  customParams: Record<string, string>;
  lineItem: { id: string; activityId: string; points: number } | null;
}

/** POST /courses/:courseId/lti/launches. */
export interface LtiLaunch {
  url: string;
  expiresAt: string;
}

export function courseLtiApi(courseId: string): string {
  return `/courses/${encodeURIComponent(courseId)}/lti`;
}

/** POST /courses/:courseId/lti/modules/:moduleId/items body. */
export function ltiItemBody(input: {
  toolId: string;
  title: string;
  customParams: string;
  points: string;
  agsEnabled: boolean;
}):
  | { body: { toolId: string; title: string; customParams?: Record<string, string>; points?: number }; problem: null }
  | { body: null; problem: string } {
  if (!input.toolId) return { body: null, problem: "Choose a tool" };
  const title = input.title.trim();
  if (!title) return { body: null, problem: "Give the item a title" };
  const custom = parseCustomParams(input.customParams);
  if (custom.params === null) return { body: null, problem: custom.problem };
  const body: { toolId: string; title: string; customParams?: Record<string, string>; points?: number } = {
    toolId: input.toolId,
    title,
  };
  if (Object.keys(custom.params).length) body.customParams = custom.params;
  const raw = input.points.trim();
  if (raw && input.agsEnabled) {
    const points = Number(raw);
    if (!Number.isFinite(points) || points < 1 || points > 100000) {
      return { body: null, problem: "Points must be between 1 and 100000" };
    }
    body.points = Math.round(points * 100) / 100;
  }
  return { body, problem: null };
}

/** The app route that starts a launch (opened in a new tab). */
export const LTI_LAUNCH_PATH = "/lti/launch";

export function ltiLaunchPath(courseId: string, itemId: string): string {
  const q = new URLSearchParams({ course: courseId, item: itemId });
  return `${LTI_LAUNCH_PATH}?${q.toString()}`;
}

/** A launch URL is only ever followed when it is http(s). */
export function safeLaunchUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** What to tell someone whose launch could not start. */
export function launchErrorMessage(err: unknown): string {
  if (isFeatureDisabledError(err)) return "External tools are turned off for your school.";
  if (err instanceof ApiError) {
    if (err.status === 404) return "This tool is no longer available. Ask your teacher.";
    if (err.status === 403) return "You don't have access to this tool.";
    if (err.status === 429) return "Too many launches. Wait a moment and try again.";
  }
  return "The tool could not be opened. Try again in a moment.";
}
