/**
 * Rostering sync (backend `src/rostering`, feature `rostering`, organisation
 * admins): sources (CSV uploads or a OneRoster 1.2 endpoint), dry runs with
 * their change sets, applies and run history. Routes live under
 * `/organisation/rostering`.
 */
import { api, apiQuery } from "@/lib/api";
import { sendToStorage } from "@/lib/files/upload";

export const ROSTERING_API = "/organisation/rostering";

export const sourceApi = (id: string) => `${ROSTERING_API}/sources/${id}`;
export const runApi = (sourceId: string, runId: string) => `${sourceApi(sourceId)}/runs/${runId}`;

// ── wire types ───────────────────────────────────────────────────────────────

export type SourceKind = "csv" | "oneroster_api";
export type RunStatus = "planning" | "planned" | "queued" | "applying" | "applied" | "failed" | "cancelled";
export type ChangeAction = "create" | "update" | "disable" | "error";
export type ChangeStatus = "pending" | "applied" | "failed" | "skipped";
export type RosterEntity =
  | "school"
  | "academic_year"
  | "term"
  | "course"
  | "student"
  | "staff"
  | "enrolment"
  | "course_staff";

export interface RosterSettings {
  /** OneRoster org id -> school id; null = ignore that org. */
  orgMap: Record<string, string | null>;
  matchBy: { email: boolean; studentNumber: boolean };
  notifyStudents: boolean;
  sendStaffInvites: boolean;
  scope: string | null;
}

export interface RosterSource {
  id: string;
  name: string;
  kind: SourceKind;
  baseUrl: string | null;
  tokenUrl: string | null;
  clientId: string | null;
  hasSecret: boolean;
  /** The stored secret no longer decrypts (the server key changed): enter it again. */
  secretUnreadable: boolean;
  settings: RosterSettings;
  schedule: "off" | "daily";
  autoApply: boolean;
  lastScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRun?: { id: string; status: RunStatus; trigger: string; createdAt: string; finishedAt: string | null } | null;
}

export interface RunOrg {
  sourcedId: string;
  name: string;
  type: string | null;
  /** Mapped school; null = ignored; absent = not mapped yet. */
  schoolId?: string | null;
}

export interface RunSummary {
  counts?: Partial<Record<RosterEntity, Partial<Record<ChangeAction, number>>>>;
  waiting?: number;
  total?: number;
  applicable?: number;
  disables?: number;
  errors?: number;
  source?: Record<string, number>;
  orgs?: RunOrg[];
}

export interface RosterRun {
  id: string;
  sourceId: string;
  trigger: "manual" | "scheduled";
  status: RunStatus;
  summary: RunSummary;
  error: string | null;
  includeDisables: boolean;
  progress: { done: number; total: number; failed: number };
  createdAt: string;
  plannedAt: string | null;
  applyStartedAt: string | null;
  finishedAt: string | null;
}

export interface RosterChange {
  id: string;
  seq: number;
  entity: RosterEntity;
  action: ChangeAction;
  sourcedId: string;
  targetId: string | null;
  schoolId: string | null;
  label: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  errors: string[];
  status: ChangeStatus;
  applyError: string | null;
  appliedAt: string | null;
}

export interface ChangeFilters {
  entity?: RosterEntity;
  action?: ChangeAction;
  status?: ChangeStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

// ── labels ───────────────────────────────────────────────────────────────────

export const ENTITY_LABELS: Record<RosterEntity, string> = {
  school: "Schools (orgs)",
  academic_year: "Academic years",
  term: "Terms",
  course: "Courses (classes)",
  student: "Students",
  staff: "Staff",
  enrolment: "Enrolments",
  course_staff: "Course teachers",
};

export const ACTION_LABELS: Record<ChangeAction, string> = {
  create: "Create",
  update: "Update",
  disable: "To disable",
  error: "Error",
};

export const STATUS_LABELS: Record<RunStatus, string> = {
  planning: "Dry run in progress",
  planned: "Ready to review",
  queued: "Waiting to apply",
  applying: "Applying",
  applied: "Applied",
  failed: "Failed",
  cancelled: "Discarded",
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  dateOfBirth: "Date of birth",
  studentNumber: "Student number",
  email: "Email",
  isActive: "Active",
  name: "Name",
  code: "Code",
  term: "Term",
  status: "Status",
  startDate: "Starts",
  endDate: "Ends",
  role: "Role",
  membership: "School membership",
  invite: "Invite",
  account: "Account",
  courseRoles: "Course roles",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** A diff value as text: blank for null, Yes/No for booleans. */
export function diffValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** True while the run is still working (poll it). */
export function runIsBusy(status: RunStatus): boolean {
  return status === "planning" || status === "queued" || status === "applying";
}

/** Count of one action across entities, from a run summary. */
export function countAction(summary: RunSummary, action: ChangeAction): number {
  return Object.values(summary.counts ?? {}).reduce((n, row) => n + (row?.[action] ?? 0), 0);
}

/** Percent applied, 0-100. */
export function progressPercent(run: Pick<RosterRun, "progress">): number {
  const { done, failed, total } = run.progress;
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((done + failed) / total) * 100));
}

/** Orgs the dry run found that are not mapped to a school (nor ignored). */
export function unmappedOrgs(orgs: RunOrg[] | undefined, map: Record<string, string | null>): RunOrg[] {
  return (orgs ?? []).filter((o) => !(o.sourcedId in map));
}

/** The QUERY body: only the filters set. */
export function changeFilters(f: ChangeFilters): ChangeFilters {
  const out: ChangeFilters = {};
  if (f.entity) out.entity = f.entity;
  if (f.action) out.action = f.action;
  if (f.status) out.status = f.status;
  if (f.search?.trim()) out.search = f.search.trim();
  if (f.limit) out.limit = f.limit;
  if (f.offset) out.offset = f.offset;
  return out;
}

export const TEMPLATE_KINDS = [
  { kind: "students", label: "Students" },
  { kind: "staff", label: "Staff" },
  { kind: "classes", label: "Classes" },
  { kind: "enrolments", label: "Enrolments" },
] as const;

// ── calls ────────────────────────────────────────────────────────────────────

export function listSources() {
  return api<RosterSource[]>(`${ROSTERING_API}/sources`);
}

export function listRuns(sourceId: string) {
  return api<RosterRun[]>(`${sourceApi(sourceId)}/runs`);
}

export function getRun(sourceId: string, runId: string) {
  return api<RosterRun>(runApi(sourceId, runId));
}

export function listChanges(sourceId: string, runId: string, filters: ChangeFilters) {
  return apiQuery<{ total: number; data: RosterChange[] }>(
    `${runApi(sourceId, runId)}/changes`,
    changeFilters(filters),
  );
}

function contentTypeFor(file: File): string {
  if (/\.zip$/i.test(file.name)) return "application/zip";
  return "text/csv";
}

/** Upload files to storage for a CSV source; returns their keys. */
export async function uploadRosterFiles(sourceId: string, files: File[]): Promise<string[]> {
  const keys: string[] = [];
  for (const file of files) {
    const contentType = contentTypeFor(file);
    const ticket = await api<{ key: string; method: "PUT"; uploadUrl: string; headers: Record<string, string> }>(
      `${sourceApi(sourceId)}/uploads`,
      { method: "POST", body: { filename: file.name, contentType, size: file.size } },
    );
    await sendToStorage(file, ticket);
    keys.push(ticket.key);
  }
  return keys;
}

export function startDryRun(sourceId: string, uploads?: string[]) {
  return api<RosterRun>(`${sourceApi(sourceId)}/runs`, {
    method: "POST",
    body: uploads ? { uploads } : {},
  });
}

export function applyRun(sourceId: string, runId: string, includeDisables: boolean) {
  return api<RosterRun>(`${runApi(sourceId, runId)}/apply`, {
    method: "POST",
    body: { includeDisables },
  });
}

export function discardRun(sourceId: string, runId: string) {
  return api<RosterRun>(`${runApi(sourceId, runId)}/cancel`, { method: "POST" });
}
