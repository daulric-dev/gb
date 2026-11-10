import { api, ApiError } from "@/lib/api";

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
  save: (body: { allowStudentWork?: boolean; providerId?: string | null }) =>
    api<AiSchoolSettings>("/schools/current/ai", { method: "PUT", body }),
};

export const aiDraftApi = {
  status: (courseId: string) => api<AiStatus>(`/courses/${courseId}/ai`),
  quizQuestions: (
    courseId: string,
    body: { pageId?: string; text?: string; count: number; kinds: AiQuestionKind[] },
  ) => api<QuizDrafts>(`/courses/${courseId}/ai/quiz-questions`, { method: "POST", body }),
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
        return "The answer was cut off. Ask for fewer questions or use a shorter text.";
      case "AI_INVALID_OUTPUT":
        return "The AI's answer was not in the expected format. Try again.";
      case "AI_NO_PROVIDER":
        return "Your organisation has not set up an AI provider for schools yet.";
      case "AI_RATE_LIMITED":
      case "AI_CAP_REACHED":
      case "AI_STUDENT_WORK_NOT_ALLOWED":
      case "AI_PROVIDER_ERROR":
      case "AI_KEY_UNREADABLE":
        return err.message;
      case "FEATURE_DISABLED":
        return "AI assistance is turned off for your school.";
    }
  }
  return "The AI request failed. Try again.";
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
