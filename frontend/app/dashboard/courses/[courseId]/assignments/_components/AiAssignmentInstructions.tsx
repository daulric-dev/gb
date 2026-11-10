"use client";

import { useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles } from "lucide-react";
import { aiCourseApi, aiErrorMessage, type AssignmentDraft } from "@/lib/ai";
import { SUBMISSION_LABEL } from "@/lib/ai-course-plan";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface AcceptedInstructions {
  instructions: string;
  points: number;
  allowText: boolean;
  allowFile: boolean;
}

/**
 * "Draft instructions with AI" for an assignment (feature `ai_assistance`).
 * Drafts instructions, suggested points and a submission type from the
 * title (and what is already written); the teacher edits the draft and
 * "Use this" fills the form. Nothing is saved until the form's own Save.
 */
export function AiAssignmentInstructions({
  courseId,
  title,
  current,
  points,
  showSubmission = true,
  onAcceptAction,
}: {
  courseId: string;
  title: string;
  /** The instructions written so far (sent as the brief to build on). */
  current: string;
  points?: number;
  /** The form can change the submission type (creating); otherwise it is shown as a note. */
  showSubmission?: boolean;
  onAcceptAction: (draft: AcceptedInstructions) => void;
}) {
  useSignals();
  const id = useId();
  const busy = useSignal(false);
  const draft = useSignal<AssignmentDraft | null>(null);
  const text = useSignal("");
  const pts = useSignal("");

  async function generate() {
    if (!title.trim()) {
      toast.error("Give the assignment a title first");
      return;
    }
    busy.value = true;
    try {
      const out = await aiCourseApi.assignment(courseId, {
        title: title.trim(),
        ...(current.trim() ? { brief: current } : {}),
        ...(points !== undefined && Number.isFinite(points) && points > 0 ? { points } : {}),
      });
      draft.value = out;
      text.value = out.instructions;
      pts.value = String(out.points);
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  function accept() {
    const d = draft.value;
    if (!d) return;
    const n = Number(pts.value);
    onAcceptAction({
      instructions: text.value,
      points: Number.isFinite(n) && n >= 0 ? n : d.points,
      allowText: d.allowText,
      allowFile: d.allowFile,
    });
    draft.value = null;
    toast.success("Draft used. Save to keep it.");
  }

  if (!draft.value) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={busy.value} onClick={() => void generate()}>
        {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
        {busy.value ? "Drafting…" : "Draft instructions with AI"}
      </Button>
    );
  }

  return (
    <section aria-label="AI instructions draft" className="space-y-3 rounded-lg border border-dashed p-3">
      <AiDraftNote>Edit it as you like. It replaces the instructions only when you use it, and is saved with the form.</AiDraftNote>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-text`}>Instructions (Markdown)</Label>
        <Textarea id={`${id}-text`} rows={8} value={text.value} onChange={(e) => (text.value = e.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-points`}>Suggested points</Label>
          <Input id={`${id}-points`} type="number" min={0} step="any" className="w-28" value={pts.value} onChange={(e) => (pts.value = e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Suggested submission: {SUBMISSION_LABEL[draft.value.submission]}
          {!showSubmission && " (change it in the assignment's settings if you want it)"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={accept}>
          Use this
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => (draft.value = null)}>
          Discard
        </Button>
      </div>
    </section>
  );
}
