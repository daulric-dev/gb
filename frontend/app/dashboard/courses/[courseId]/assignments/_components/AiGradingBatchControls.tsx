"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles, Square } from "lucide-react";
import {
  aiErrorMessage,
  aiGradingApi,
  batchProgress,
  formatChars,
  gradingProblemMessage,
  type AiBatchPreview,
  type AiGradingBatch,
} from "@/lib/ai";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiDraftNote } from "@/components/ai/ai-draft-note";

/**
 * "Draft for all ungraded": a confirmation that says how many submissions,
 * files and (at most) characters will go to which provider and who is left
 * out, then one background job per submission. Shows progress while it
 * runs; drafts fill in on the marks table as they finish. Cancel stops the
 * drafts still waiting.
 */
export function AiGradingBatchControls({
  activityId,
  batch,
  problem,
  onBatchAction,
}: {
  activityId: string;
  batch: AiGradingBatch | null;
  /** Why drafting cannot run (overview setup.problem), or null. */
  problem: string | null;
  onBatchAction: (batch: AiGradingBatch) => void;
}) {
  useSignals();
  const preview = useSignal<AiBatchPreview | null>(null);
  const confirming = useSignal(false);
  const busy = useSignal(false);

  async function openPreview() {
    busy.value = true;
    try {
      preview.value = await aiGradingApi.preview(activityId);
      confirming.value = true;
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  async function start() {
    const p = preview.value;
    if (!p) return;
    busy.value = true;
    try {
      onBatchAction(await aiGradingApi.start(activityId, p.submissions));
      confirming.value = false;
      toast.success(`Drafting ${p.submissions} submission${p.submissions === 1 ? "" : "s"} in the background`);
    } catch (err) {
      toast.error(aiErrorMessage(err));
      // The numbers changed: show them again.
      preview.value = await aiGradingApi.preview(activityId).catch(() => p);
    } finally {
      busy.value = false;
    }
  }

  async function cancel() {
    if (!batch) return;
    busy.value = true;
    try {
      onBatchAction(await aiGradingApi.cancel(activityId, batch.id));
      toast.success("Stopped: drafts still waiting were cancelled");
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  const running = batch?.status === "running";
  const progress = batch ? batchProgress(batch) : null;
  const p = preview.value;
  const problemText = gradingProblemMessage(problem);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {running && progress ? (
        <div className="flex min-w-64 items-center gap-2" aria-live="polite">
          <Progress value={progress.percent} className="w-40" aria-label="AI drafts finished" />
          <span className="text-xs text-muted-foreground">
            AI drafts {progress.done}/{progress.total}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void cancel()} disabled={busy.value}>
            <Square className="mr-1 size-3.5" aria-hidden />
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void openPreview()}
          disabled={busy.value || !!problem}
          title={problemText ?? undefined}
        >
          {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
          Draft for all ungraded
        </Button>
      )}
      {problemText && !running && <span className="text-xs text-muted-foreground">{problemText}</span>}
      {batch && !running && batch.status !== "running" && (
        <span className="text-xs text-muted-foreground">
          Last run {batch.status === "cancelled" ? "cancelled" : "finished"}: {batch.counts.ready} drafted
          {batch.counts.failed ? `, ${batch.counts.failed} failed` : ""}
          {batch.counts.skipped ? `, ${batch.counts.skipped} skipped` : ""}.
        </span>
      )}

      <Dialog open={confirming.value} onOpenChange={(v) => (confirming.value = v)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Draft marks with AI for all ungraded work?</DialogTitle>
            <DialogDescription>
              Each submission is one AI request, run in the background. Nothing is marked or shown to
              students: you review each draft and save the mark yourself.
            </DialogDescription>
          </DialogHeader>
          {p && (
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>{p.submissions}</strong> submission{p.submissions === 1 ? "" : "s"} with{" "}
                  <strong>{p.files}</strong> readable file{p.files === 1 ? "" : "s"}
                </li>
                <li>
                  At most {formatChars(p.maxChars)} of text in all (at most {formatChars(p.maxCharsPerSubmission)} per
                  submission; longer work is cut)
                </li>
                <li>
                  Sent to <strong>{p.provider.name}</strong> ({p.provider.model}, {p.provider.host}) with names,
                  emails and phone numbers replaced
                </li>
                <li>
                  {p.mode === "rubric" ? "Suggested rubric levels" : "A suggested score and requirements checklist"}, with
                  quotes from the work and overall feedback
                </li>
                <li>
                  Your hourly AI limit: {p.usedThisHour} of {p.hourlyLimit} used. Drafts past it wait and run later.
                </li>
                {p.alreadyGraded > 0 && <li>{p.alreadyGraded} already marked (left alone)</li>}
              </ul>
              {p.skipped.length > 0 && (
                <div>
                  <p className="font-medium">Left out ({p.skipped.length})</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {p.skipped.map((s) => (
                      <li key={s.studentId}>
                        <span translate="no">{s.name}</span>: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.tooMany && (
                <p className="text-destructive">At most {p.maxSubmissions} submissions can be drafted at once.</p>
              )}
              <AiDraftNote>{p.note}</AiDraftNote>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => (confirming.value = false)} disabled={busy.value}>
              Cancel
            </Button>
            <Button onClick={() => void start()} disabled={busy.value || !p || p.submissions === 0 || p.tooMany}>
              {busy.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {p && p.submissions > 0 ? `Send ${p.submissions} for drafting` : "Nothing to draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
