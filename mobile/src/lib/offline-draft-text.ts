import type { AnswerLike } from "@/lib/sync-queue";

/**
 * A draft as plain text, for the "view / share or copy" actions on a draft
 * that could not be sent (deadline passed offline, conflict). Pure.
 */

export interface DraftQuestion {
  id: string;
  prompt: string;
  kind: string;
  options: { id: string; label: string }[];
}

function answerText(question: DraftQuestion, answer: AnswerLike | undefined): string {
  if (!answer) return "(no answer)";
  const label = (id: string) =>
    question.options.find((o) => o.id === id)?.label ?? "(unknown option)";
  switch (question.kind) {
    case "multiple_choice":
    case "true_false":
      return answer.optionId ? label(answer.optionId) : "(no answer)";
    case "multiple_select":
      return answer.optionIds?.length
        ? answer.optionIds.map(label).join("; ")
        : "(no answer)";
    case "ordering":
      return answer.optionIds?.length
        ? answer.optionIds.map((id, i) => `${i + 1}) ${label(id)}`).join("  ")
        : "(no answer)";
    case "matching": {
      const pairs = Array.isArray(answer.matches)
        ? answer.matches.map((m) => [m.optionId, m.label] as const)
        : Object.entries(answer.matches ?? {});
      return pairs.length
        ? pairs.map(([id, choice]) => `${label(id)} → ${choice}`).join("; ")
        : "(no answer)";
    }
    case "numeric":
      return typeof answer.numeric === "number"
        ? String(answer.numeric)
        : "(no answer)";
    case "file_upload":
      return answer.fileId ? "(file attached)" : "(no answer)";
    default:
      return answer.text?.trim() ? answer.text.trim() : "(no answer)";
  }
}

export function quizDraftText(
  title: string,
  questions: DraftQuestion[],
  answers: AnswerLike[],
): string {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const lines = [title, ""];
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.prompt}`);
    lines.push(`Answer: ${answerText(q, byQuestion.get(q.id))}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

export function textDraftText(title: string, text: string): string {
  return `${title}\n\n${text}`.trimEnd();
}
