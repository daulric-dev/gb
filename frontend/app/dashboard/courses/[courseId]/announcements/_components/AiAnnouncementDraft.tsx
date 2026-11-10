"use client";

import { useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles } from "lucide-react";
import { aiCourseApi, aiErrorMessage } from "@/lib/ai";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Draft an announcement" in the course announcement composer (feature
 * `ai_assistance`; anyone who may post course announcements, TAs included).
 * The teacher describes it in a line or two; the draft title and body are
 * shown for review and "Use this draft" fills the composer. Nothing is
 * posted until the composer's own Post.
 */
export function AiAnnouncementDraft({
  courseId,
  onUseAction,
}: {
  courseId: string;
  onUseAction: (title: string, body: string) => void;
}) {
  useSignals();
  const id = useId();
  const open = useSignal(false);
  const prompt = useSignal("");
  const busy = useSignal(false);
  const draft = useSignal<{ title: string; body: string } | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.value.trim()) return;
    busy.value = true;
    try {
      const out = await aiCourseApi.announcement(courseId, prompt.value.trim());
      draft.value = { title: out.title, body: out.body };
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  if (!open.value) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => (open.value = true)}>
        <Sparkles className="mr-1.5 size-4" aria-hidden />
        Draft an announcement with AI
      </Button>
    );
  }

  return (
    <section aria-label="AI announcement draft" className="space-y-3 rounded-lg border border-dashed p-3">
      <form onSubmit={(e) => void generate(e)} className="space-y-2">
        <Label htmlFor={`${id}-prompt`}>What is it about?</Label>
        <Textarea
          id={`${id}-prompt`}
          rows={2}
          maxLength={2000}
          placeholder="Museum trip on Friday 14 March, leave 9am, bring a packed lunch"
          value={prompt.value}
          onChange={(e) => (prompt.value = e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Written for the course&apos;s students (parents may read it too). Give the details: missing ones are left as [placeholders].</p>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy.value || !prompt.value.trim()}>
            {busy.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
            {busy.value ? "Drafting…" : "Draft it"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => {
              open.value = false;
              draft.value = null;
            }}>
            Close
          </Button>
        </div>
      </form>
      {draft.value && (
        <div className="space-y-2">
          <AiDraftNote>Check the details. It fills the form when you use it, and is posted only when you post it.</AiDraftNote>
          <p className="text-sm font-medium">{draft.value.title}</p>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{draft.value.body}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onUseAction(draft.value!.title, draft.value!.body);
                draft.value = null;
                open.value = false;
              }}
            >
              Use this draft
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => (draft.value = null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
