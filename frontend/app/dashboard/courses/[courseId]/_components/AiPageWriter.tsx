"use client";

import { useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, PenLine } from "lucide-react";
import { aiCourseApi, aiErrorMessage } from "@/lib/ai";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Write this page with AI" in the page editor (feature `ai_assistance`).
 * Drafts the whole page in Markdown from its title and what is already
 * written (used as the outline) plus the course's name and description. The
 * teacher edits the draft, then replaces the editor's text or adds it at
 * the end; the page is saved only by the editor's own Save.
 */
export function AiPageWriter({
  courseId,
  title,
  text,
  onUseAction,
}: {
  courseId: string;
  title: string;
  /** The editor's text (sent as the outline to build on). */
  text: string;
  onUseAction: (markdown: string, how: "replace" | "append") => void;
}) {
  useSignals();
  const id = useId();
  const asking = useSignal(false);
  const level = useSignal("");
  const busy = useSignal(false);
  const draft = useSignal<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Give the page a title first");
      return;
    }
    busy.value = true;
    try {
      const out = await aiCourseApi.pageContent(courseId, {
        title: title.trim(),
        ...(text.trim() ? { outline: text } : {}),
        ...(level.value.trim() ? { level: level.value.trim() } : {}),
      });
      draft.value = out.markdown;
      asking.value = false;
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  function use(how: "replace" | "append") {
    if (draft.value === null) return;
    onUseAction(draft.value, how);
    draft.value = null;
    toast.success("Draft added to the editor. Save the page to keep it.");
  }

  if (draft.value !== null) {
    return (
      <section aria-label="AI page draft" className="w-full space-y-3 rounded-lg border border-dashed p-3">
        <AiDraftNote>Check the facts and edit it for your class. It goes into the page only when you use it and save.</AiDraftNote>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-draft`}>Page draft (Markdown)</Label>
          <Textarea id={`${id}-draft`} rows={14} value={draft.value} onChange={(e) => (draft.value = e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => use("replace")}>
            Replace the page text
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => use("append")}>
            Add at the end
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => (draft.value = null)}>
            Discard
          </Button>
        </div>
      </section>
    );
  }

  if (asking.value) {
    return (
      <form onSubmit={(e) => void generate(e)} className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-level`}>Level (optional)</Label>
          <Input id={`${id}-level`} className="w-48" placeholder="e.g. Year 9" value={level.value} onChange={(e) => (level.value = e.target.value)} maxLength={100} />
        </div>
        <p className="min-w-48 flex-1 text-xs text-muted-foreground">
          Uses the page title{text.trim() ? " and what you have written as the outline" : ""}, and the course name and description. No student data is sent.
        </p>
        <Button type="submit" size="sm" disabled={busy.value}>
          {busy.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
          {busy.value ? "Writing…" : "Write the draft"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => (asking.value = false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => (asking.value = true)}>
      <PenLine className="mr-1.5 size-4" aria-hidden />
      Write this page with AI
    </Button>
  );
}
