"use client";

import { useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles } from "lucide-react";
import { aiDraftApi, aiErrorMessage, summaryMarkdown } from "@/lib/ai";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Summarise for students with AI" in the page editor (feature
 * `ai_assistance`). The summary and key points come back as plain text the
 * teacher edits, then inserts into the editor; the page is saved only by
 * the editor's own Save.
 */
export function AiPageSummary({
  courseId,
  pageId,
  text,
  onInsertAction,
}: {
  courseId: string;
  pageId: string;
  /** The editor's current text (summarised as it stands, saved or not). */
  text: string;
  onInsertAction: (block: string, where: "top" | "end") => void;
}) {
  useSignals();
  const id = useId();
  const busy = useSignal(false);
  const summary = useSignal<string | null>(null);
  const points = useSignal("");

  async function generate() {
    if (!text.trim()) {
      toast.error("Write the page first");
      return;
    }
    busy.value = true;
    try {
      const out = await aiDraftApi.pageSummary(courseId, pageId, text);
      summary.value = out.summary;
      points.value = out.keyPoints.join("\n");
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  function insert(where: "top" | "end") {
    if (summary.value === null) return;
    onInsertAction(summaryMarkdown(summary.value, points.value.split("\n")), where);
    summary.value = null;
    toast.success("Summary inserted. Save the page to keep it.");
  }

  if (summary.value === null) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={busy.value} onClick={() => void generate()}>
        {busy.value ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="mr-1.5 size-4" aria-hidden />
        )}
        {busy.value ? "Summarising…" : "Summarise for students with AI"}
      </Button>
    );
  }

  return (
    <section aria-label="AI summary draft" className="space-y-3 rounded-lg border border-dashed p-3">
      <AiDraftNote>Edit it as you like. It is added to the page only when you insert it and save.</AiDraftNote>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-summary`}>Summary</Label>
        <Textarea
          id={`${id}-summary`}
          rows={4}
          value={summary.value}
          onChange={(e) => (summary.value = e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-points`}>Key points (one per line)</Label>
        <Textarea
          id={`${id}-points`}
          rows={5}
          value={points.value}
          onChange={(e) => (points.value = e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => insert("top")}>
          Insert at the top
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => insert("end")}>
          Insert at the end
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => (summary.value = null)}>
          Discard
        </Button>
      </div>
    </section>
  );
}
