import { api, ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { CreatePlanBody, PlanItem, PlanItemKind, PlanModule, SubmissionType } from "@/lib/ai-course-plan";

/**
 * AI assistance (API `src/ai`, feature `ai_assistance`). The organisation
 * brings its own provider; teachers ask for drafts (quiz questions, rubric
 * feedback suggestions, page summaries) that they review, edit and accept.
 * Nothing a draft route returns is saved until the teacher accepts it
 * through the normal routes. Model output is shown as plain text only.
 */

export type AiProviderKind = "anthropic" | "openai_compatible";

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string | null;
  host: string;
  model: string;
  hasKey: boolean;
  keyLast4: string;
  keyUnreadable: boolean;
  monthlyCap: number | null;
  isDefault: boolean;
  /** Runs on the organisation's private network: private addresses and http allowed for it only. */
  allowPrivateNetwork: boolean;
  /** Schools may choose it in their AI settings. */
  availableToSchools: boolean;
  usedThisMonth?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderList {
  providers: AiProvider[];
  suggestions: Record<AiProviderKind, string[]>;
}

export interface AiOrgSettings {
  keepPrompts: boolean;
  userHourlyLimit: number;
}

export interface AiUsageRow {
  id: string;
  userId: string | null;
  schoolId: string | null;
  courseId: string | null;
  feature: string;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  promptKept: boolean;
  createdAt: string;
}

export interface AiProviderSummary {
  id: string;
  name: string;
  kind: AiProviderKind;
  model: string;
  host: string;
}

export interface AiStatus {
  /** The provider requests from this school go to. */
  provider: AiProviderSummary | null;
  allowStudentWork: boolean;
  /** Text read from uploaded files may be sent (AI grading drafts); needs allowStudentWork too. */
  allowStudentFiles?: boolean;
  notice: string;
  note?: string;
}

/** The school settings card: the status plus the provider choice. */
export interface AiSchoolSettings extends AiStatus {
  /** The school's stored choice; null = organisation default. */
  providerId: string | null;
  /** The stored choice was withdrawn by the organisation, so the default is used. */
  choiceUnavailable: boolean;
  organisationDefault: AiProviderSummary | null;
  availableProviders: AiProviderSummary[];
}

/** Value of the "organisation default" option in the school's provider choice. */
export const ORG_DEFAULT_CHOICE = "";

/** Label of the "organisation default" option, naming the provider when there is one. */
export function orgDefaultLabel(d: AiProviderSummary | null): string {
  return d ? `Organisation default (${d.name})` : "Organisation default (none available)";
}

export const AI_QUESTION_KINDS = [
  "multiple_choice",
  "true_false",
  "short_answer",
  "multiple_select",
  "numeric",
  "matching",
  "ordering",
  "essay",
] as const;
export type AiQuestionKind = (typeof AI_QUESTION_KINDS)[number];

export interface QuestionDraft {
  kind: AiQuestionKind;
  prompt: string;
  points: number;
  options: { label: string; isCorrect: boolean; matchLabel: string | null }[];
  numericAnswer: number | null;
  numericTolerance: number;
  scoring: "all_or_nothing";
  explanation: string;
}

export interface QuizDrafts {
  drafts: QuestionDraft[];
  rejected: number;
  requestId: string;
  provider: string;
  note: string;
}

export interface QuizQuestionDraftStatus {
  status: "idle" | "running" | "ready" | "failed";
  drafts?: QuestionDraft[];
  rejected?: number;
  error?: string;
  startedAt?: number;
}

export interface RubricSuggestion {
  criterionId: string;
  ratingId: string | null;
  points: number | null;
  comment: string;
}

export interface RubricSuggestions {
  suggestions: RubricSuggestion[];
  feedback: string;
  requestId: string;
  provider: string;
  note: string;
}

export interface PageSummary {
  summary: string;
  keyPoints: string[];
  requestId: string;
  provider: string;
  note: string;
}

// ── course building (API src/ai/ai-course.service.ts) ─────────────────────

interface DraftMeta {
  requestId: string;
  provider: string;
  note: string;
}

export const OUTLINE_MIXES = ["balanced", "more_quizzes", "more_assignments", "quizzes_only", "assignments_only"] as const;
export type OutlineMix = (typeof OUTLINE_MIXES)[number];
export const OUTLINE_MIX_LABEL: Record<OutlineMix, string> = {
  balanced: "Balanced quizzes and assignments",
  more_quizzes: "Mostly quizzes",
  more_assignments: "Mostly assignments",
  quizzes_only: "Quizzes only",
  assignments_only: "Assignments only",
};

export interface OutlineRequest {
  subject: string;
  level: string;
  weeks?: number;
  units?: number;
  goals?: string;
  syllabus?: string;
  assessments?: number;
  mix?: OutlineMix;
  outcomes?: boolean;
  groups?: boolean;
}

export interface OutlineDraft extends DraftMeta {
  plan: { modules: PlanModule[] };
  masteryOn: boolean;
  /** The course's term (else academic year) start, YYYY-MM-DD, or null. */
  startDate: string | null;
  existingGroups: string[];
}

export type CreatedStatus = "created" | "failed" | "not_added" | "skipped";

export interface PlanCreateResult {
  ok: boolean;
  created: { modules: number; items: number; groups: number; outcomes: number };
  failed: number;
  startDate: string | null;
  modules: {
    title: string;
    moduleId: string | null;
    status: "created" | "existing" | "failed";
    error: string | null;
    items: { kind: PlanItemKind; title: string; status: CreatedStatus; id: string | null; error: string | null; dueAt: string | null; aligned: string[] }[];
  }[];
  groups: { name: string; id: string | null; status: "existing" | "created" | "failed"; error: string | null }[];
  outcomes: { code: string; title: string; id: string | null; status: "existing" | "created" | "failed"; error: string | null }[];
  quizzes: { activityId: string; title: string; topic: string; questionCount: number | null }[];
  draftQuestions: boolean;
  notes: string[];
}

export interface ModuleItemsDraft extends DraftMeta {
  moduleId: string;
  moduleTitle: string;
  items: PlanItem[];
}

export interface RubricDraft extends DraftMeta {
  rubric: {
    title: string;
    criteria: { title: string; description: string | null; points: number; ratings: { label: string; description: string | null; points: number }[] }[];
  };
  dropped: number;
}

export interface AssignmentDraft extends DraftMeta {
  instructions: string;
  points: number;
  submission: SubmissionType;
  allowText: boolean;
  allowFile: boolean;
}

export interface OutcomeSuggestion {
  code: string;
  title: string;
  description: string;
}

export const aiCourseApi = {
  outline: (courseId: string, body: OutlineRequest) =>
    api<OutlineDraft>(`/courses/${courseId}/ai/outline`, { method: "POST", body }),
  /** The only route that creates anything: the reviewed, selected plan, all unpublished. */
  createPlan: (courseId: string, body: CreatePlanBody) =>
    api<PlanCreateResult>(`/courses/${courseId}/ai/plan/create`, { method: "POST", body }),
  moduleItems: (courseId: string, moduleId: string, body: { brief?: string; count?: number; level?: string }) =>
    api<ModuleItemsDraft>(`/courses/${courseId}/modules/${moduleId}/ai/items`, { method: "POST", body }),
  pageContent: (courseId: string, body: { title: string; outline?: string; level?: string }) =>
    api<{ markdown: string } & DraftMeta>(`/courses/${courseId}/ai/page-content`, { method: "POST", body }),
  assignment: (courseId: string, body: { title: string; brief?: string; level?: string; points?: number }) =>
    api<AssignmentDraft>(`/courses/${courseId}/ai/assignment-instructions`, { method: "POST", body }),
  rubric: (courseId: string, body: { title: string; instructions?: string; totalPoints?: number; criteria?: number; level?: string }) =>
    api<RubricDraft>(`/courses/${courseId}/ai/rubric`, { method: "POST", body }),
  announcement: (courseId: string, prompt: string) =>
    api<{ title: string; body: string } & DraftMeta>(`/courses/${courseId}/ai/announcement`, { method: "POST", body: { prompt } }),
  outcomes: (courseId: string, body: { brief?: string; count?: number; level?: string }) =>
    api<{ outcomes: OutcomeSuggestion[] } & DraftMeta>(`/courses/${courseId}/ai/outcomes`, { method: "POST", body }),
};

/** One line summing up a plan creation for a toast. */
export function planResultSummary(r: PlanCreateResult): string {
  const parts = [`${r.created.modules} module${r.created.modules === 1 ? "" : "s"}`, `${r.created.items} item${r.created.items === 1 ? "" : "s"}`];
  if (r.created.outcomes) parts.push(`${r.created.outcomes} outcome${r.created.outcomes === 1 ? "" : "s"}`);
  const head = `Created ${parts.join(", ")} (unpublished).`;
  return r.failed ? `${head} ${r.failed} could not be created: see the report.` : head;
}

export const AI_ORG_API = "/organisation/ai";

/** Shown on every AI draft. */
export const AI_DRAFT_LABEL = "AI-generated — review before using";

export const PROVIDER_KIND_LABEL: Record<AiProviderKind, string> = {
  anthropic: "Anthropic",
  openai_compatible: "OpenAI-compatible",
};

export const aiOrgApi = {
  list: () => api<AiProviderList>(`${AI_ORG_API}/providers`),
  create: (body: Record<string, unknown>) =>
    api<AiProvider>(`${AI_ORG_API}/providers`, { method: "POST", body, stepUp: true }),
  update: (id: string, body: Record<string, unknown>) =>
    api<AiProvider>(`${AI_ORG_API}/providers/${id}`, { method: "PATCH", body, stepUp: true }),
  setDefault: (id: string) =>
    api<AiProvider>(`${AI_ORG_API}/providers/${id}/default`, { method: "POST", stepUp: true }),
  remove: (id: string) => api(`${AI_ORG_API}/providers/${id}`, { method: "DELETE", stepUp: true }),
  test: (id: string) =>
    api<{ ok: boolean; message: string }>(`${AI_ORG_API}/providers/${id}/test`, { method: "POST" }),
  settings: () => api<AiOrgSettings>(`${AI_ORG_API}/settings`),
  saveSettings: (body: Partial<AiOrgSettings>) =>
    api<AiOrgSettings>(`${AI_ORG_API}/settings`, { method: "PUT", body, stepUp: true }),
  usage: () => api<{ thisMonth: number; requests: AiUsageRow[] }>(`${AI_ORG_API}/usage`),
};

export const aiSchoolApi = {
  get: () => api<AiSchoolSettings>("/schools/current/ai"),
  /** `providerId`: a provider id, null for the organisation default; left out = unchanged. */
  save: (body: { allowStudentWork?: boolean; allowStudentFiles?: boolean; providerId?: string | null }) =>
    api<AiSchoolSettings>("/schools/current/ai", { method: "PUT", body, stepUp: true }),
};

export const aiDraftApi = {
  status: (courseId: string) => api<AiStatus>(`/courses/${courseId}/ai`),
  quizQuestions: (
    courseId: string,
    body: { pageId?: string; text?: string; count: number; kinds: AiQuestionKind[] },
  ) => api<QuizDrafts>(`/courses/${courseId}/ai/quiz-questions`, { method: "POST", body }),
  quizQuestionsStatus: (activityId: string) =>
    api<QuizQuestionDraftStatus>(`/activities/${activityId}/ai/quiz-questions`),
  startQuizQuestions: (
    activityId: string,
    body: { pageId?: string; text?: string; count: number; kinds: AiQuestionKind[] },
  ) =>
    api<QuizQuestionDraftStatus>(`/activities/${activityId}/ai/quiz-questions`, {
      method: "POST",
      body,
    }),
  clearQuizQuestions: (activityId: string) =>
    api<{ ok: boolean }>(`/activities/${activityId}/ai/quiz-questions`, {
      method: "DELETE",
    }),
  rubricFeedback: (activityId: string, studentId: string) =>
    api<RubricSuggestions>(`/activities/${activityId}/ai/rubric-feedback`, {
      method: "POST",
      body: { studentId },
    }),
  pageSummary: (courseId: string, pageId: string, text?: string) =>
    api<PageSummary>(`/courses/${courseId}/pages/${pageId}/ai/summary`, {
      method: "POST",
      body: text !== undefined ? { text } : {},
    }),
};

/** What to tell a teacher when an AI request fails. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "AI_REFUSED":
        return "The model declined this request. Try rewording the text, or write this yourself.";
      case "AI_TRUNCATED":
        return "The answer was cut off. Ask for less (fewer questions, units or items) or use a shorter text.";
      case "AI_INVALID_OUTPUT":
        return "The AI's answer was not in the expected format. Try again.";
      case "AI_NO_PROVIDER":
        return "Your organisation has not set up an AI provider for schools yet.";
      case "AI_RATE_LIMITED":
      case "AI_CAP_REACHED":
      case "AI_STUDENT_WORK_NOT_ALLOWED":
      case "AI_STUDENT_FILES_NOT_ALLOWED":
      case "AI_STUDENT_RESTRICTED":
      case "AI_BATCH_CHANGED":
      case "AI_BATCH_RUNNING":
      case "AI_PROVIDER_ERROR":
      case "AI_KEY_UNREADABLE":
        return err.message;
      case "FEATURE_DISABLED":
        return "AI assistance is turned off for your school.";
    }
    if (err.status === 429) return "Too many AI requests in the last minute. Wait a moment and try again.";
  }
  // Anything else (validation, permission, network, server): the API's own
  // wording, or the generic text when there is none to show.
  return userMessage(err, "The AI request failed. Try again.");
}

/** A draft as the question form's initial value (it never has an id until saved). */
export function draftAsQuestion(d: QuestionDraft, key: string) {
  return {
    id: key,
    prompt: d.prompt,
    kind: d.kind,
    points: d.points,
    options: d.options.map((o, i) => ({
      id: `${key}-o${i}`,
      label: o.label,
      isCorrect: o.isCorrect,
      matchLabel: o.matchLabel,
    })),
    numericAnswer: d.numericAnswer,
    numericTolerance: d.numericTolerance,
    scoring: d.scoring,
  };
}

/** The summary block a teacher inserts into a page (Markdown, plain text inside). */
export function summaryMarkdown(summary: string, keyPoints: string[]): string {
  const points = keyPoints.map((p) => p.trim()).filter(Boolean);
  const parts = ["## Summary", "", summary.trim()];
  if (points.length) parts.push("", "**Key points**", "", ...points.map((p) => `- ${p}`));
  return parts.join("\n");
}

/** Model ids to suggest per kind; any id can be typed. */
export function modelSuggestions(
  list: AiProviderList | null,
  kind: AiProviderKind,
): string[] {
  return list?.suggestions[kind] ?? [];
}

// ── AI grading drafts for handed-in files (API src/ai/file-grading) ─────────

export type DraftStatus = "queued" | "running" | "ready" | "failed" | "skipped" | "cancelled";
export type DraftMode = "rubric" | "score";
export type FileReadStatus = "read" | "truncated" | "unreadable" | "skipped";
export type RequirementStatus = "met" | "partly" | "not_met";

export interface FileReport {
  fileId: string | null;
  name: string;
  status: FileReadStatus;
  reason: string | null;
  chars: number;
  pages: number | null;
}

export interface RubricDraftCriterion {
  criterionId: string;
  title: string;
  maxPoints: number;
  ratingId: string | null;
  ratingLabel: string | null;
  points: number | null;
  comment: string;
  evidence: string[];
}

export type GradingDraft =
  | {
      mode: "rubric";
      criteria: RubricDraftCriterion[];
      suggestedTotal: number;
      feedback: string;
      feedbackEvidence: string[];
      evidenceDropped: number;
    }
  | {
      mode: "score";
      score: number;
      points: number;
      requirements: { requirement: string; status: RequirementStatus; comment: string; evidence: string[] }[];
      feedback: string;
      feedbackEvidence: string[];
      evidenceDropped: number;
    };

export interface AiGradingDraftView {
  id: string;
  studentId: string;
  submissionId: string;
  status: DraftStatus;
  mode: DraftMode;
  files: FileReport[];
  draft: GradingDraft | null;
  charsSent: number | null;
  truncated: boolean;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  errorCode: string | null;
  error: string | null;
  /** The student handed in again after this draft was made. */
  stale: boolean;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  note: string;
}

export interface AiDraftSummary {
  studentId: string;
  status: DraftStatus;
  mode: DraftMode;
  errorCode: string | null;
  error: string | null;
  suggestedScore: number | null;
  stale: boolean;
  batchId: string | null;
  updatedAt: string;
}

export interface AiGradingBatch {
  id: string;
  status: "running" | "done" | "cancelled";
  provider: string;
  model: string;
  total: number;
  files: number;
  counts: Record<DraftStatus, number>;
  createdAt: string;
  finishedAt: string | null;
  cancelledAt: string | null;
}

export interface AiGradingOverview {
  setup: {
    provider: AiProviderSummary | null;
    notice: string;
    allowStudentWork: boolean;
    allowStudentFiles: boolean;
    /** Why drafting cannot run here, or null. */
    problem: string | null;
    mode: DraftMode;
    points: number;
    limits: { maxChars: number; maxFileMb: number; maxFiles: number; maxPages: number; maxBatch: number };
  };
  drafts: AiDraftSummary[];
  batch: AiGradingBatch | null;
  note: string;
}

export interface AiBatchPreview {
  provider: { name: string; model: string; host: string };
  mode: DraftMode;
  submissions: number;
  files: number;
  maxChars: number;
  maxCharsPerSubmission: number;
  skipped: { studentId: string; name: string; code: string; reason: string }[];
  alreadyGraded: number;
  tooMany: boolean;
  maxSubmissions: number;
  hourlyLimit: number;
  usedThisHour: number;
  note: string;
}

const gradingBase = (activityId: string) => `/activities/${activityId}/ai/grading`;

export const aiGradingApi = {
  overview: (activityId: string) => api<AiGradingOverview>(gradingBase(activityId)),
  draft: (activityId: string, studentId: string) =>
    api<AiGradingDraftView>(`${gradingBase(activityId)}/drafts`, { method: "POST", body: { studentId } }),
  get: (activityId: string, studentId: string) =>
    api<AiGradingDraftView>(`${gradingBase(activityId)}/drafts/${studentId}`),
  discard: (activityId: string, studentId: string) =>
    api<void>(`${gradingBase(activityId)}/drafts/${studentId}`, { method: "DELETE" }),
  preview: (activityId: string) => api<AiBatchPreview>(`${gradingBase(activityId)}/batch/preview`),
  start: (activityId: string, expectedSubmissions: number) =>
    api<AiGradingBatch>(`${gradingBase(activityId)}/batch`, { method: "POST", body: { expectedSubmissions } }),
  batch: (activityId: string, batchId: string) =>
    api<AiGradingBatch>(`${gradingBase(activityId)}/batch/${batchId}`),
  cancel: (activityId: string, batchId: string) =>
    api<AiGradingBatch>(`${gradingBase(activityId)}/batch/${batchId}/cancel`, { method: "POST" }),
};

/** Plain words for why AI grading drafts cannot run (overview `problem`, draft `errorCode`). */
export function gradingProblemMessage(code: string | null): string | null {
  switch (code) {
    case null:
      return null;
    case "AI_NO_PROVIDER":
      return "AI is not set up: your organisation has not added an AI provider for schools yet.";
    case "AI_STUDENT_WORK_NOT_ALLOWED":
      return "Your school does not allow sending students' work to the AI provider. A school admin can change this in Settings.";
    case "AI_STUDENT_FILES_NOT_ALLOWED":
      return "Your school does not allow sending uploaded files to the AI provider. A school admin can change this in Settings.";
    case "AI_NOT_ASSIGNMENT":
      return "AI grading drafts are for assignments with handed-in work.";
    case "AI_STUDENT_RESTRICTED":
      return "This student's record restricts AI processing, so their work is never sent.";
    case "NOTHING_READABLE":
      return "Nothing in this hand-in could be read as text (images, scans and other files are not read), so nothing was sent.";
    case "NOT_HANDED_IN":
      return "Nothing is handed in.";
    case "ALREADY_GRADED":
      return "Marked before the draft ran.";
    case "ALREADY_DRAFTED":
      return "Already has an AI draft of this work.";
    case "CANCELLED":
      return "Cancelled before it ran.";
    case "INTERRUPTED":
      return "Interrupted: ask for this draft again.";
    case "WAITING_FOR_LIMIT":
      return "Waiting: you reached your hourly AI limit; it will try again shortly.";
    default:
      return null;
  }
}

export const FILE_STATUS_LABEL: Record<FileReadStatus, string> = {
  read: "Read",
  truncated: "Partly read",
  unreadable: "Can't read",
  skipped: "Not read",
};

export const REQUIREMENT_LABEL: Record<RequirementStatus, string> = {
  met: "Met",
  partly: "Partly met",
  not_met: "Not met",
};

/** The marks-table badge for a student's draft. */
export function draftBadge(d: AiDraftSummary | undefined): { label: string; tone: "ready" | "busy" | "problem" | "muted" } | null {
  if (!d) return null;
  switch (d.status) {
    case "ready":
      return {
        label: d.stale ? "AI draft (older work)" : d.suggestedScore !== null ? `AI draft: ${d.suggestedScore}` : "AI draft",
        tone: d.stale ? "muted" : "ready",
      };
    case "queued":
      return { label: d.errorCode === "WAITING_FOR_LIMIT" ? "AI draft waiting" : "AI draft queued", tone: "busy" };
    case "running":
      return { label: "AI drafting…", tone: "busy" };
    case "failed":
      return { label: d.errorCode === "NOTHING_READABLE" ? "AI: nothing readable" : "AI draft failed", tone: "problem" };
    case "skipped":
      return { label: d.errorCode === "AI_STUDENT_RESTRICTED" ? "AI: opted out" : "AI: skipped", tone: "muted" };
    case "cancelled":
      return { label: "AI draft cancelled", tone: "muted" };
  }
}

/** Finished / total, for the batch progress bar (skipped and cancelled count as finished). */
export function batchProgress(b: AiGradingBatch): { done: number; total: number; percent: number } {
  const c = b.counts;
  const total = c.queued + c.running + c.ready + c.failed + c.skipped + c.cancelled;
  const done = c.ready + c.failed + c.skipped + c.cancelled;
  return { done, total, percent: total === 0 ? 100 : Math.round((done / total) * 100) };
}

/** "12,300 characters" style counts. */
export function formatChars(n: number): string {
  return `${n.toLocaleString("en")} character${n === 1 ? "" : "s"}`;
}

/** The criteria the teacher accepted, as rubric marking picks (criterion id -> level, points, comment). */
export function acceptedRubricPicks(
  criteria: RubricDraftCriterion[],
  accepted: Record<string, boolean>,
  comments: Record<string, string>,
): Record<string, { ratingId: string | null; points: number | null; comment: string }> {
  const out: Record<string, { ratingId: string | null; points: number | null; comment: string }> = {};
  for (const c of criteria) {
    if (!accepted[c.criterionId]) continue;
    out[c.criterionId] = {
      ratingId: c.ratingId,
      points: c.points,
      comment: (comments[c.criterionId] ?? c.comment).trim(),
    };
  }
  return out;
}
