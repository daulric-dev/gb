import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  acceptedRubricPicks,
  aiErrorMessage,
  batchProgress,
  draftAsQuestion,
  draftBadge,
  formatChars,
  gradingProblemMessage,
  orgDefaultLabel,
  summaryMarkdown,
  type AiDraftSummary,
  type AiGradingBatch,
  type QuestionDraft,
  type RubricDraftCriterion,
} from "@/lib/ai";
import { FALLBACK_FEATURES, resolveFeatures } from "@/lib/features";

describe("AI helpers", () => {
  test("a draft becomes the question form's initial value, without a saved id", () => {
    const draft: QuestionDraft = {
      kind: "matching",
      prompt: "Match",
      points: 2,
      options: [
        { label: "a", isCorrect: false, matchLabel: "1" },
        { label: "b", isCorrect: false, matchLabel: "2" },
      ],
      numericAnswer: null,
      numericTolerance: 0,
      scoring: "all_or_nothing",
      explanation: "why",
    };
    const q = draftAsQuestion(draft, "ai-1");
    expect(q.id).toBe("ai-1");
    expect(q.options.map((o) => [o.label, o.matchLabel])).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect("explanation" in q).toBe(false);
  });

  test("the summary block is Markdown with plain text inside, blank points dropped", () => {
    expect(summaryMarkdown(" Plants make food. ", ["Light", " ", "Water"])).toBe(
      "## Summary\n\nPlants make food.\n\n**Key points**\n\n- Light\n- Water",
    );
    expect(summaryMarkdown("Only this", [])).toBe("## Summary\n\nOnly this");
  });

  test("error codes become clear messages; refusals say the model declined", () => {
    expect(aiErrorMessage(new ApiError(422, "x", { code: "AI_REFUSED" }))).toContain("declined");
    expect(
      aiErrorMessage(new ApiError(403, "Your school does not allow it", { code: "AI_STUDENT_WORK_NOT_ALLOWED" })),
    ).toBe("Your school does not allow it");
    expect(aiErrorMessage(new ApiError(403, "x", { code: "FEATURE_DISABLED" }))).toContain("turned off");
    expect(aiErrorMessage(new Error("boom"))).toBe("The AI request failed. Try again.");
  });

  test("ai_assistance is off on older servers and when not sent", () => {
    expect(FALLBACK_FEATURES.ai_assistance).toBe(false);
    expect(resolveFeatures({}).ai_assistance).toBe(false);
    expect(resolveFeatures({ ai_assistance: true }).ai_assistance).toBe(true);
  });

  test("the organisation default option names the provider", () => {
    expect(
      orgDefaultLabel({ id: "p", name: "Anthropic", kind: "anthropic", model: "claude-opus-5-5", host: "api.anthropic.com" }),
    ).toBe("Organisation default (Anthropic)");
    expect(orgDefaultLabel(null)).toBe("Organisation default (none available)");
  });
});

describe("course builder helpers", () => {
  test("planResultSummary says what was created (unpublished) and flags failures", async () => {
    const { planResultSummary } = await import("@/lib/ai");
    const base = { ok: true, created: { modules: 2, items: 5, groups: 1, outcomes: 0 }, failed: 0, startDate: null, modules: [], groups: [], outcomes: [], quizzes: [], draftQuestions: false, notes: [] };
    expect(planResultSummary(base)).toBe("Created 2 modules, 5 items (unpublished).");
    expect(planResultSummary({ ...base, ok: false, failed: 2, created: { ...base.created, outcomes: 1 } })).toBe(
      "Created 2 modules, 5 items, 1 outcome (unpublished). 2 could not be created: see the report.",
    );
  });
});

describe("AI grading drafts", () => {
  const summary = (over: Partial<AiDraftSummary>): AiDraftSummary => ({
    studentId: "s1",
    status: "ready",
    mode: "score",
    errorCode: null,
    error: null,
    suggestedScore: 14,
    stale: false,
    batchId: null,
    updatedAt: "2026-11-14T00:00:00Z",
    ...over,
  });

  test("marks-table badges say what state each draft is in", () => {
    expect(draftBadge(undefined)).toBeNull();
    expect(draftBadge(summary({}))).toEqual({ label: "AI draft: 14", tone: "ready" });
    expect(draftBadge(summary({ stale: true }))?.tone).toBe("muted");
    expect(draftBadge(summary({ status: "queued" }))?.label).toBe("AI draft queued");
    expect(draftBadge(summary({ status: "queued", errorCode: "WAITING_FOR_LIMIT" }))?.label).toBe("AI draft waiting");
    expect(draftBadge(summary({ status: "failed", errorCode: "NOTHING_READABLE" }))).toEqual({ label: "AI: nothing readable", tone: "problem" });
    expect(draftBadge(summary({ status: "skipped", errorCode: "AI_STUDENT_RESTRICTED" }))?.label).toBe("AI: opted out");
  });

  test("batch progress counts skipped and cancelled drafts as finished", () => {
    const b = {
      counts: { queued: 2, running: 1, ready: 4, failed: 1, skipped: 1, cancelled: 1 },
    } as AiGradingBatch;
    expect(batchProgress(b)).toEqual({ done: 7, total: 10, percent: 70 });
    expect(batchProgress({ counts: { queued: 0, running: 0, ready: 0, failed: 0, skipped: 0, cancelled: 0 } } as AiGradingBatch).percent).toBe(100);
  });

  test("only accepted criteria reach the rubric form, with the teacher's edited comments", () => {
    const criteria: RubricDraftCriterion[] = [
      { criterionId: "c1", title: "A", maxPoints: 10, ratingId: "r1", ratingLabel: "Strong", points: 10, comment: "Good", evidence: [] },
      { criterionId: "c2", title: "B", maxPoints: 5, ratingId: "r3", ratingLabel: "Clear", points: 5, comment: "Fine", evidence: [] },
    ];
    expect(acceptedRubricPicks(criteria, { c1: true }, { c1: " Edited " })).toEqual({
      c1: { ratingId: "r1", points: 10, comment: "Edited" },
    });
    expect(acceptedRubricPicks(criteria, {}, {})).toEqual({});
  });

  test("problem codes become plain messages for each error state", () => {
    expect(gradingProblemMessage(null)).toBeNull();
    expect(gradingProblemMessage("AI_NO_PROVIDER")).toContain("not set up");
    expect(gradingProblemMessage("AI_STUDENT_FILES_NOT_ALLOWED")).toContain("uploaded files");
    expect(gradingProblemMessage("AI_STUDENT_RESTRICTED")).toContain("restricts AI");
    expect(gradingProblemMessage("NOTHING_READABLE")).toContain("could be read");
    expect(gradingProblemMessage("SOMETHING_ELSE")).toBeNull();
    expect(aiErrorMessage(new ApiError(403, "Not allowed for files", { code: "AI_STUDENT_FILES_NOT_ALLOWED" }))).toBe("Not allowed for files");
    expect(formatChars(12300)).toBe("12,300 characters");
    expect(formatChars(1)).toBe("1 character");
  });
});
