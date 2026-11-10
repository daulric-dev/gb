"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Sparkles } from "lucide-react";
import type { CourseModule } from "@/lib/courses/types";
import { aiCourseApi, aiErrorMessage, planResultSummary, type PlanCreateResult } from "@/lib/ai";
import { countSelected, fromDraft, parseWhole, planProblems, toCreateBody, type PlanTree } from "@/lib/ai-course-plan";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlanTreeEditor } from "../../_components/ai-plan/PlanTreeEditor";
import { PlanCreateReport } from "../../_components/ai-plan/PlanCreateReport";

/**
 * "Suggest items for this module" (feature `ai_assistance`, course teachers
 * and admins). Suggestions use the same item shapes as the course outline;
 * the teacher edits and ticks them, and "Add selected" creates them in this
 * module, unpublished. Nothing is added before that.
 */
export function AiModuleItemsDialog({
  courseId,
  base,
  module,
  onOpenChangeAction,
  onAddedAction,
}: {
  courseId: string;
  base: string;
  module: CourseModule | null;
  onOpenChangeAction: (open: boolean) => void;
  onAddedAction: () => void;
}) {
  useSignals();
  const id = useId();
  const brief = useSignal("");
  const count = useSignal("5");
  const busy = useSignal(false);
  const creating = useSignal(false);
  const tree = useSignal<PlanTree>([]);
  const result = useSignal<PlanCreateResult | null>(null);

  useEffect(() => {
    if (!module) return;
    tree.value = [];
    result.value = null;
    brief.value = "";
  }, [module, tree, result, brief]);

  async function suggest(e: React.FormEvent) {
    e.preventDefault();
    if (!module) return;
    busy.value = true;
    try {
      const n = parseWhole(count.value, 1, 15);
      const out = await aiCourseApi.moduleItems(courseId, module.id, {
        ...(brief.value.trim() ? { brief: brief.value } : {}),
        ...(n !== null ? { count: n } : {}),
      });
      tree.value = fromDraft([{ title: module.title, overview: "", items: out.items, outcomes: [] }], module.id);
      if (!out.items.length) toast.message("No items were suggested. Try describing what you want.");
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      busy.value = false;
    }
  }

  async function add() {
    const problems = planProblems(tree.value);
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    creating.value = true;
    try {
      const out = await aiCourseApi.createPlan(courseId, toCreateBody(tree.value));
      result.value = out;
      if (out.ok) toast.success(planResultSummary(out));
      else toast.warning(planResultSummary(out));
      onAddedAction();
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      creating.value = false;
    }
  }

  const selected = countSelected(tree.value).items;

  return (
    <Dialog open={!!module} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Suggest items for {module?.title}</DialogTitle>
          <DialogDescription>
            Pages, assignments and quizzes that fit this module. Uses the module&apos;s and course&apos;s titles; no student data is sent.
          </DialogDescription>
        </DialogHeader>

        {result.value ? (
          <PlanCreateReport result={result.value} base={base} />
        ) : tree.value.length === 0 ? (
          <form onSubmit={(e) => void suggest(e)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-brief`}>What should it cover? (optional)</Label>
              <Textarea id={`${id}-brief`} rows={3} maxLength={4000} value={brief.value} onChange={(e) => (brief.value = e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-count`}>How many items</Label>
              <Input id={`${id}-count`} type="number" min={1} max={15} className="w-24" value={count.value} onChange={(e) => (count.value = e.target.value)} />
            </div>
            <Button type="submit" disabled={busy.value}>
              {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
              {busy.value ? "Suggesting…" : "Suggest items"}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <AiDraftNote>Edit and tick what to keep. Only ticked items are added, unpublished.</AiDraftNote>
            <PlanTreeEditor tree={tree.value} onChangeAction={(t) => (tree.value = t)} singleModule showDueWeeks={false} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChangeAction(false)}>
            {result.value ? "Close" : "Cancel"}
          </Button>
          {!result.value && tree.value.length > 0 && (
            <Button onClick={() => void add()} disabled={creating.value || selected === 0}>
              {creating.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
              Add selected ({selected})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
