"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SubmissionRow } from "./types";

/** GET /api/activities/:id/submissions/:studentId/answers */
interface QuizAnswers {
  submissionId: string;
  status: "draft" | "submitted" | "graded";
  inProgress: boolean;
  needsMarking: boolean;
  questions: {
    id: string;
    prompt: string;
    kind: string;
    points: number;
    manual: boolean;
    scoring: "all_or_nothing" | "partial";
    numericAnswer: number | null;
    numericTolerance: number;
    options: { id: string; label: string; isCorrect: boolean; matchLabel: string | null }[];
    answer: {
      optionId: string | null;
      optionIds: string[] | null;
      matches: { optionId: string; label: string }[] | null;
      text: string | null;
      numeric: number | null;
      fileId: string | null;
      file: { id: string; name: string; contentType: string } | null;
    } | null;
    earned: number;
    needsMarking: boolean;
    mark: { points: number; feedback: string | null; markedAt: string | null } | null;
  }[];
}

/** The marked submission the mark endpoint returns. */
interface Marked {
  status: "draft" | "submitted" | "graded";
  score: number | null;
}

const KIND_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  short_answer: "Short answer",
  essay: "Essay",
  multiple_select: "Multiple select",
  numeric: "Numeric",
  matching: "Matching",
  ordering: "Ordering",
  file_upload: "File upload",
};

/** What the student answered, in words. */
function answerText(q: QuizAnswers["questions"][number]): string {
  const a = q.answer;
  if (!a) return "No answer";
  const label = (id: string) => q.options.find((o) => o.id === id)?.label ?? "?";
  switch (q.kind) {
    case "multiple_choice":
    case "true_false":
      return a.optionId ? label(a.optionId) : "No answer";
    case "multiple_select":
      return a.optionIds?.length ? a.optionIds.map(label).join(", ") : "No answer";
    case "ordering":
      return a.optionIds?.length ? a.optionIds.map(label).join(" → ") : "No answer";
    case "matching":
      return a.matches?.length
        ? a.matches.map((m) => `${label(m.optionId)} → ${m.label}`).join("; ")
        : "No answer";
    case "numeric":
      return a.numeric === null ? "No answer" : String(a.numeric);
    case "file_upload":
      return a.file?.name ?? "No file";
    default:
      return a.text?.trim() ? a.text : "No answer";
  }
}

/** The answer key, in words (staff only). */
function keyText(q: QuizAnswers["questions"][number]): string | null {
  switch (q.kind) {
    case "multiple_choice":
    case "true_false":
    case "multiple_select":
      return q.options.filter((o) => o.isCorrect).map((o) => o.label).join(", ");
    case "short_answer":
      return q.options.map((o) => o.label).join(" / ");
    case "ordering":
      return q.options.map((o) => o.label).join(" → ");
    case "matching":
      return q.options.map((o) => `${o.label} → ${o.matchLabel ?? ""}`).join("; ");
    case "numeric":
      return q.numericAnswer === null
        ? null
        : `${q.numericAnswer}${q.numericTolerance ? ` ± ${q.numericTolerance}` : ""}`;
    default:
      return null;
  }
}

/**
 * One student's quiz, question by question: their answers next to the key,
 * what each auto-marked question earned, and a mark (points and a comment)
 * for each essay and file question. The quiz stays "needs marking" until
 * every answered essay and file question has a mark.
 */
export function QuizAnswersDialog({
  activityId,
  student,
  onOpenChangeAction,
  onMarkedAction,
}: {
  activityId: string;
  student: SubmissionRow | null;
  onOpenChangeAction: (open: boolean) => void;
  onMarkedAction: (studentId: string, marked: Marked) => void;
}) {
  useSignals();
  const data = useSignal<QuizAnswers | null>(null);
  const loading = useSignal(false);
  const saving = useSignal<string | null>(null);
  const drafts = useSignal<Record<string, { points: string; feedback: string }>>({});

  const studentId = student?.studentId ?? null;
  useEffect(() => {
    if (!studentId) return;
    loading.value = true;
    data.value = null;
    api<QuizAnswers>(`/activities/${activityId}/submissions/${studentId}/answers`)
      .then((res) => {
        data.value = res;
        drafts.value = Object.fromEntries(
          res.questions
            .filter((q) => q.manual)
            .map((q) => [
              q.id,
              { points: q.mark ? String(q.mark.points) : "", feedback: q.mark?.feedback ?? "" },
            ]),
        );
      })
      .catch((err) => toast.error(userMessage(err, "Could not load the answers")))
      .finally(() => (loading.value = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, studentId]);

  async function save(questionId: string, max: number) {
    if (!studentId) return;
    const draft = drafts.value[questionId];
    const points = Number(draft?.points);
    if (!draft || draft.points.trim() === "" || !Number.isFinite(points) || points < 0 || points > max) {
      toast.error(`Give 0 to ${max} points`);
      return;
    }
    saving.value = questionId;
    try {
      const marked = await api<Marked>(
        `/activities/${activityId}/submissions/${studentId}/questions/${questionId}/mark`,
        { method: "PUT", body: { points, feedback: draft.feedback.trim() || undefined } },
      );
      onMarkedAction(studentId, marked);
      if (data.value) {
        data.value = {
          ...data.value,
          status: marked.status,
          needsMarking: marked.status === "submitted",
          questions: data.value.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  needsMarking: false,
                  earned: points,
                  mark: { points, feedback: draft.feedback.trim() || null, markedAt: new Date().toISOString() },
                }
              : q,
          ),
        };
      }
      toast.success(marked.status === "graded" ? "Marked; the quiz is now graded" : "Mark saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save the mark"));
    } finally {
      saving.value = null;
    }
  }

  const d = data.value;
  return (
    <Dialog open={!!student} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{student?.name ?? "Student"}: answers</DialogTitle>
          <DialogDescription>
            Auto-marked questions are scored already. Give points to each essay and file question.
          </DialogDescription>
        </DialogHeader>
        {loading.value || !d ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span className="sr-only">Loading answers</span>
          </div>
        ) : (
          <div className="space-y-4">
            <p aria-live="polite" className="text-sm">
              {d.inProgress ? (
                <Badge variant="outline">Still taking the quiz</Badge>
              ) : d.needsMarking ? (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                  Needs marking
                </Badge>
              ) : (
                <Badge variant="outline">Marked</Badge>
              )}
            </p>
            <ol className="space-y-4">
              {d.questions.map((q, i) => {
                const key = keyText(q);
                const draft = drafts.value[q.id];
                return (
                  <li key={q.id} className="rounded-lg border p-3">
                    <h3 className="text-sm font-medium">
                      {i + 1}. {q.prompt}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABEL[q.kind] ?? q.kind} · {q.points} {q.points === 1 ? "point" : "points"}
                      {q.scoring === "partial" &&
                        ["multiple_select", "matching", "ordering"].includes(q.kind) &&
                        " · partial credit"}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      <span className="font-medium">Answer: </span>
                      {answerText(q)}
                    </p>
                    {q.answer?.file && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() =>
                          void downloadFromUrl(
                            `/activities/submissions/${d.submissionId}/file?fileId=${q.answer!.file!.id}`,
                            q.answer!.file!.name,
                          )
                        }
                      >
                        <Download className="size-4" aria-hidden /> Download {q.answer.file.name}
                      </Button>
                    )}
                    {key && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium">Key: </span>
                        {key}
                      </p>
                    )}
                    {!q.manual ? (
                      <p className="mt-1 text-sm">
                        Earned {q.earned} of {q.points}
                      </p>
                    ) : (
                      <form
                        className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void save(q.id, q.points);
                        }}
                      >
                        <div className="grid gap-1">
                          <Label htmlFor={`pts-${q.id}`}>Points (of {q.points})</Label>
                          <Input
                            id={`pts-${q.id}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={q.points}
                            step="0.01"
                            value={draft?.points ?? ""}
                            disabled={d.inProgress}
                            onChange={(e) =>
                              (drafts.value = {
                                ...drafts.value,
                                [q.id]: { points: e.target.value, feedback: draft?.feedback ?? "" },
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`fb-${q.id}`}>Comment (optional)</Label>
                          <Textarea
                            id={`fb-${q.id}`}
                            rows={1}
                            value={draft?.feedback ?? ""}
                            disabled={d.inProgress}
                            onChange={(e) =>
                              (drafts.value = {
                                ...drafts.value,
                                [q.id]: { points: draft?.points ?? "", feedback: e.target.value },
                              })
                            }
                          />
                        </div>
                        <Button type="submit" size="sm" disabled={d.inProgress || saving.value === q.id}>
                          {saving.value === q.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                          {q.mark ? "Update mark" : "Save mark"}
                        </Button>
                        {q.needsMarking && (
                          <p className="text-xs text-amber-700 dark:text-amber-400 sm:col-span-3">Not marked yet</p>
                        )}
                      </form>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
