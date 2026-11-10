"use client";

import { useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { aiCourseApi, aiErrorMessage, type OutcomeSuggestion } from "@/lib/ai";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface Row extends OutcomeSuggestion {
  key: string;
  selected: boolean;
}

/**
 * "Suggest outcomes" on a course's outcomes page (features `ai_assistance`
 * and `mastery`, course teachers and admins). Suggestions come from the
 * course's module, page and assessment titles; the teacher edits and picks
 * them, and "Add selected" creates each through the normal add-outcome route.
 */
export function AiOutcomeSuggestions({ courseId, onAddedAction }: { courseId: string; onAddedAction: () => Promise<void> }) {
  useSignals();
  const id = useId();
  const busy = useSignal(false);
  const adding = useSignal(false);
  const rows = useSignal<Row[]>([]);

  async function suggest() {
    busy.value = true;
    try {
      const out = await aiCourseApi.outcomes(courseId, {});
      const stamp = Date.now();
      rows.value = out.outcomes.map((o, i) => ({ ...o, key: `s${stamp}-${i}`, selected: true }));
      if (!out.outcomes.length) toast.message("No new outcomes were suggested.");
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  const patch = (key: string, p: Partial<Row>) => (rows.value = rows.value.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function addSelected() {
    const chosen = rows.value.filter((r) => r.selected && r.code.trim() && r.title.trim());
    if (!chosen.length) return;
    adding.value = true;
    const failed: string[] = [];
    for (const r of chosen) {
      try {
        await api(`/courses/${courseId}/outcomes`, {
          method: "POST",
          body: { code: r.code.trim(), title: r.title.trim(), ...(r.description.trim() ? { description: r.description.trim() } : {}) },
        });
        rows.value = rows.value.filter((x) => x.key !== r.key);
      } catch (err) {
        failed.push(`${r.code}: ${userMessage(err, "could not be added")}`);
      }
    }
    adding.value = false;
    if (failed.length) toast.error(`Not added: ${failed.join("; ")}`);
    else toast.success(`${chosen.length} outcome${chosen.length === 1 ? "" : "s"} added`);
    await onAddedAction();
  }

  if (!rows.value.length) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={busy.value} onClick={() => void suggest()}>
        {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
        {busy.value ? "Suggesting…" : "Suggest outcomes with AI"}
      </Button>
    );
  }

  const count = rows.value.filter((r) => r.selected).length;
  return (
    <section aria-label="AI outcome suggestions" className="space-y-3 rounded-lg border border-dashed p-3">
      <AiDraftNote>Suggested from your course&apos;s titles. Edit and tick the ones to keep; only those are added.</AiDraftNote>
      <ul className="space-y-2">
        {rows.value.map((r, i) => (
          <li key={r.key} className="grid gap-2 sm:grid-cols-[auto_8rem_1fr] sm:items-center">
            <Checkbox
              id={`${id}-${i}`}
              checked={r.selected}
              onCheckedChange={(v) => patch(r.key, { selected: v === true })}
              aria-label={`Keep outcome ${r.code}`}
            />
            <Input aria-label={`Code of suggestion ${i + 1}`} value={r.code} maxLength={64} onChange={(e) => patch(r.key, { code: e.target.value })} />
            <Input aria-label={`Outcome ${i + 1}`} value={r.title} maxLength={500} onChange={(e) => patch(r.key, { title: e.target.value })} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={adding.value || count === 0} onClick={() => void addSelected()}>
          {adding.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
          Add selected ({count})
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => (rows.value = [])}>
          Discard
        </Button>
      </div>
    </section>
  );
}
