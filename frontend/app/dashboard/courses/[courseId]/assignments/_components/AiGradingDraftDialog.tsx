"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Quote, Sparkles, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import type { Rubric } from "@/lib/courses/types";
import {
  acceptedRubricPicks,
  aiErrorMessage,
  aiGradingApi,
  FILE_STATUS_LABEL,
  formatChars,
  gradingProblemMessage,
  REQUIREMENT_LABEL,
  type AiDraftSummary,
  type AiGradingDraftView,
  type FileReport,
} from "@/lib/ai";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiDraftNote } from "@/components/ai/ai-draft-note";

/** What "Apply to grading form" hands the rubric marking dialog. */
export interface RubricPrefill {
  picks: Record<string, { ratingId: string | null; points: number | null; comment: string }>;
  feedback: string;
}

/** What "Apply to grading form" hands the score form. */
export interface ScorePrefill {
  score: number | null;
  feedback: string;
}

function toSummary(v: AiGradingDraftView): AiDraftSummary {
  const d = v.draft;
  return {
    studentId: v.studentId,
    status: v.status,
    mode: v.mode,
    errorCode: v.errorCode,
    error: v.error,
    suggestedScore: d ? (d.mode === "score" ? d.score : d.suggestedTotal) : null,
    stale: v.stale,
    batchId: v.batchId,
    updatedAt: v.updatedAt,
  };
}

function Evidence({ quotes }: { quotes: string[] }) {
  if (!quotes.length) return null;
  return (
    <ul className="mt-1 space-y-1" aria-label="Quotes from the work">
      {quotes.map((q, i) => (
        <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
          <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="italic" translate="no">
            {q}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FileList({ files, charsSent, truncated }: { files: FileReport[]; charsSent: number | null; truncated: boolean }) {
  return (
    <div className="space-y-1 rounded-md border p-2">
      <p className="text-xs font-medium">What was read</p>
      {files.length === 0 && <p className="text-xs text-muted-foreground">No files: only the typed text was read.</p>}
      <ul className="space-y-1">
        {files.map((f, i) => (
          <li key={f.fileId ?? i} className="flex flex-wrap items-start gap-2 text-xs">
            <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-56 truncate font-medium" translate="no">
              {f.name}
            </span>
            <Badge
              variant="outline"
              className={cn(
                f.status === "read" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
                f.status === "truncated" && "border-amber-500/40 text-amber-700 dark:text-amber-400",
                (f.status === "unreadable" || f.status === "skipped") && "border-destructive/40 text-destructive",
              )}
            >
              {FILE_STATUS_LABEL[f.status]}
            </Badge>
            {f.reason && <span className="basis-full pl-5 text-muted-foreground">{f.reason}</span>}
          </li>
        ))}
      </ul>
      {charsSent !== null && (
        <p className="text-xs text-muted-foreground">
          Sent {formatChars(charsSent)} of text
          {truncated && " (cut to fit the length limit: the end of the work was not read)"}.
        </p>
      )}
    </div>
  );
}

/**
 * The AI grading draft for one student's handed-in work: per-file read
 * status, the suggested rubric levels (each accepted by the teacher, never
 * pre-applied) or the suggested score with a requirement checklist,
 * evidence quoted from the work, and overall feedback the teacher edits.
 * "Apply to grading form" fills the normal form; nothing is saved until the
 * teacher saves the mark there. "Discard" deletes the draft.
 */
export function AiGradingDraftDialog({
  open,
  activityId,
  student,
  rubric,
  points,
  onOpenChangeAction,
  onChangedAction,
  onApplyRubricAction,
  onApplyScoreAction,
}: {
  open: boolean;
  activityId: string;
  student: { studentId: string; name: string } | null;
  rubric: Rubric | null;
  points: number;
  onOpenChangeAction: (open: boolean) => void;
  /** The draft's new summary for the marks table, or null when discarded. */
  onChangedAction: (studentId: string, summary: AiDraftSummary | null) => void;
  onApplyRubricAction: (prefill: RubricPrefill) => void;
  onApplyScoreAction: (prefill: ScorePrefill) => void;
}) {
  useSignals();
  const view = useSignal<AiGradingDraftView | null>(null);
  const loading = useSignal(false);
  const busy = useSignal(false);
  const problem = useSignal<string | null>(null);
  const accepted = useSignal<Record<string, boolean>>({});
  const comments = useSignal<Record<string, string>>({});
  const feedback = useSignal("");
  const score = useSignal("");

  function load(v: AiGradingDraftView | null) {
    view.value = v;
    accepted.value = {};
    const d = v?.draft;
    comments.value = d?.mode === "rubric" ? Object.fromEntries(d.criteria.map((c) => [c.criterionId, c.comment])) : {};
    feedback.value = d?.feedback ?? "";
    score.value = d?.mode === "score" ? String(d.score) : "";
    problem.value = v && v.status !== "ready" ? (gradingProblemMessage(v.errorCode) ?? v.error) : null;
  }

  useEffect(() => {
    if (!open || !student) return;
    let active = true;
    load(null);
    loading.value = true;
    aiGradingApi
      .get(activityId, student.studentId)
      .then((v) => {
        if (active) load(v);
      })
      .catch((err) => {
        if (active && !(err instanceof ApiError && err.status === 404)) toast.error(aiErrorMessage(err));
      })
      .finally(() => {
        if (active) loading.value = false;
      });
    return () => {
      active = false;
    };
    // Reload only when the dialog opens for a student.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activityId, student?.studentId]);

  async function draft() {
    if (!student) return;
    busy.value = true;
    problem.value = null;
    try {
      const v = await aiGradingApi.draft(activityId, student.studentId);
      load(v);
      onChangedAction(student.studentId, toSummary(v));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      problem.value = gradingProblemMessage(code ?? null) ?? aiErrorMessage(err);
    } finally {
      busy.value = false;
    }
  }

  async function discard() {
    if (!student) return;
    busy.value = true;
    try {
      await aiGradingApi.discard(activityId, student.studentId);
      onChangedAction(student.studentId, null);
      load(null);
      toast.success("AI draft discarded");
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  function apply() {
    const d = view.value?.draft;
    if (!d) return;
    if (d.mode === "rubric") {
      onApplyRubricAction({ picks: acceptedRubricPicks(d.criteria, accepted.value, comments.value), feedback: feedback.value.trim() });
    } else {
      const raw = score.value.trim();
      const n = raw === "" ? null : Number(raw);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > points)) {
        toast.error(`Score must be between 0 and ${points}`);
        return;
      }
      onApplyScoreAction({ score: n, feedback: feedback.value.trim() });
    }
  }

  const v = view.value;
  const d = v?.draft ?? null;
  const acceptedCount = Object.values(accepted.value).filter(Boolean).length;
  const rubricMismatch = d?.mode === "rubric" && !rubric;

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            AI draft for <span translate="no">{student?.name}</span>
          </DialogTitle>
          <DialogDescription>
            The text of the handed-in files (PDF, Word, text and code files) is read here, names are
            replaced, and only that text goes to the AI provider. You review and change everything;
            nothing is saved or shown to the student until you save the mark.
          </DialogDescription>
        </DialogHeader>

        {loading.value ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            {problem.value && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {problem.value}
              </p>
            )}
            {v?.status === "queued" || v?.status === "running" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {v.status === "queued" ? "Waiting in the queue…" : "Reading the work…"}
              </p>
            ) : null}
            {v && v.files.length > 0 && <FileList files={v.files} charsSent={v.charsSent} truncated={v.truncated} />}
            {v?.stale && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                The student handed in again after this draft was made. Draft again to read the new work.
              </p>
            )}

            {d && (
              <>
                <AiDraftNote>
                  {v?.provider ? `From ${v.provider}${v.model ? ` (${v.model})` : ""}. ` : ""}
                  Quotes are checked against the work; {d.evidenceDropped > 0 ? `${d.evidenceDropped} the AI made up or misquoted were removed. ` : ""}
                  Nothing changes until you apply it and save the mark.
                </AiDraftNote>

                {d.mode === "rubric" ? (
                  <div className="space-y-2">
                    {rubricMismatch && (
                      <p className="text-xs text-destructive">The activity no longer has this rubric. Draft again.</p>
                    )}
                    {d.criteria.map((c) => (
                      <div key={c.criterionId} className="space-y-1.5 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-start gap-2 text-sm">
                            <Checkbox
                              checked={!!accepted.value[c.criterionId]}
                              disabled={c.points === null}
                              onCheckedChange={(on) => (accepted.value = { ...accepted.value, [c.criterionId]: !!on })}
                              aria-label={`Accept the suggestion for ${c.title}`}
                            />
                            <span>
                              <span className="font-medium">{c.title}</span>
                              <span className="block text-xs text-muted-foreground">
                                Suggested:{" "}
                                <span translate="no">
                                  {c.ratingLabel ? `${c.ratingLabel} (${c.points}/${c.maxPoints})` : "no level (no evidence found)"}
                                </span>
                              </span>
                            </span>
                          </label>
                        </div>
                        <Input
                          value={comments.value[c.criterionId] ?? ""}
                          onChange={(e) => (comments.value = { ...comments.value, [c.criterionId]: e.target.value })}
                          aria-label={`Comment on ${c.title}`}
                          className="h-8"
                          translate="no"
                        />
                        <Evidence quotes={c.evidence} />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Suggested total <span translate="no">{d.suggestedTotal}</span>. Tick the criteria to use; only
                      ticked ones are filled in on the rubric form.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="aiDraftScore" className="text-sm">
                        Suggested score
                      </Label>
                      <Input
                        id="aiDraftScore"
                        inputMode="decimal"
                        className="h-8 w-24"
                        value={score.value}
                        onChange={(e) => (score.value = e.target.value)}
                        translate="no"
                      />
                      <span className="text-sm text-muted-foreground">/{points}</span>
                    </div>
                    <ul className="space-y-2" aria-label="Requirements checklist">
                      {d.requirements.map((r, i) => (
                        <li key={i} className="rounded-lg border p-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            {r.status === "met" ? (
                              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                            ) : (
                              <AlertTriangle className={cn("size-4", r.status === "partly" ? "text-amber-600" : "text-destructive")} aria-hidden />
                            )}
                            <span className="font-medium" translate="no">
                              {r.requirement}
                            </span>
                            <Badge variant="outline">{REQUIREMENT_LABEL[r.status]}</Badge>
                          </div>
                          {r.comment && (
                            <p className="mt-1 text-xs text-muted-foreground" translate="no">
                              {r.comment}
                            </p>
                          )}
                          <Evidence quotes={r.evidence} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-1">
                  <Label htmlFor="aiDraftFeedback" className="text-xs">
                    Overall feedback
                  </Label>
                  <Textarea
                    id="aiDraftFeedback"
                    rows={4}
                    value={feedback.value}
                    onChange={(e) => (feedback.value = e.target.value)}
                    translate="no"
                  />
                  <Evidence quotes={d.feedbackEvidence} />
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {v && (
            <Button variant="ghost" className="mr-auto" onClick={() => void discard()} disabled={busy.value}>
              <Trash2 className="mr-1.5 size-4" aria-hidden />
              Discard
            </Button>
          )}
          <Button variant="outline" onClick={() => void draft()} disabled={busy.value || loading.value || !student}>
            {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
            {busy.value ? "Reading the work…" : v ? "Draft again" : "Draft with AI"}
          </Button>
          {d && (
            <Button
              onClick={apply}
              disabled={busy.value || rubricMismatch || (d.mode === "rubric" && acceptedCount === 0 && !feedback.value.trim())}
            >
              Apply to grading form
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
