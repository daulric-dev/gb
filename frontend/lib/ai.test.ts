import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import { aiErrorMessage, draftAsQuestion, orgDefaultLabel, summaryMarkdown, type QuestionDraft } from "@/lib/ai";
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
