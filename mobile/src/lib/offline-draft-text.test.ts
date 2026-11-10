import { describe, expect, test } from "bun:test";
import { quizDraftText, textDraftText } from "./offline-draft-text";

describe("draft text", () => {
  test("renders each question with its answer", () => {
    const text = quizDraftText(
      "Quiz 1",
      [
        { id: "q1", prompt: "Pick one", kind: "multiple_choice", options: [{ id: "a", label: "Apple" }] },
        { id: "q2", prompt: "Explain", kind: "essay", options: [] },
        { id: "q3", prompt: "Match", kind: "matching", options: [{ id: "m", label: "Cat" }] },
        { id: "q4", prompt: "How many", kind: "numeric", options: [] },
        { id: "q5", prompt: "Skipped", kind: "short_answer", options: [] },
      ],
      [
        { questionId: "q1", optionId: "a" },
        { questionId: "q2", text: " Because. " },
        { questionId: "q3", matches: [{ optionId: "m", label: "Meow" }] },
        { questionId: "q4", numeric: 0 },
      ],
    );
    expect(text).toBe(
      [
        "Quiz 1",
        "",
        "1. Pick one",
        "Answer: Apple",
        "",
        "2. Explain",
        "Answer: Because.",
        "",
        "3. Match",
        "Answer: Cat → Meow",
        "",
        "4. How many",
        "Answer: 0",
        "",
        "5. Skipped",
        "Answer: (no answer)",
      ].join("\n"),
    );
  });

  test("text drafts", () => {
    expect(textDraftText("Essay", "Hello\n")).toBe("Essay\n\nHello");
  });
});
