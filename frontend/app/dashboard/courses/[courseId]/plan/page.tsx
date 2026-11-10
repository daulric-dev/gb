"use client";

import { useId } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, Loader2, Plus, Sparkles } from "lucide-react";
import {
  OUTLINE_MIXES,
  OUTLINE_MIX_LABEL,
  aiCourseApi,
  aiErrorMessage,
  planResultSummary,
  type OutlineDraft,
  type OutlineMix,
  type PlanCreateResult,
} from "@/lib/ai";
import { addModule, countSelected, fromDraft, parseWhole, planProblems, selectAll, toCreateBody, type PlanTree } from "@/lib/ai-course-plan";
import { useFeatures } from "@/hooks/use-features";
import { AiDraftNote } from "@/components/ai/ai-draft-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { PlanTreeEditor } from "../_components/ai-plan/PlanTreeEditor";
import { PlanCreateReport } from "../_components/ai-plan/PlanCreateReport";

/**
 * "Plan this course with AI" (feature `ai_assistance`, course teachers and
 * admins). The teacher describes the course; the AI drafts an outline of
 * modules, pages, assignments, quizzes (and outcomes while mastery is on);
 * the teacher edits it as a tree and "Create selected" creates only the
 * ticked parts, all unpublished. Nothing is created before that.
 */
export default function PlanCoursePage() {
  useSignals();
  const id = useId();
  const { course, base, canManage } = useCourse();
  const { hasFeature } = useFeatures();
  const aiOn = hasFeature("ai_assistance");

  const subject = useSignal(course.name);
  const level = useSignal("");
  const lengthMode = useSignal<"weeks" | "units">("weeks");
  const length = useSignal("10");
  const goals = useSignal("");
  const syllabus = useSignal("");
  const assessments = useSignal("");
  const mix = useSignal<OutlineMix>("balanced");
  const wantOutcomes = useSignal(true);
  const useGroups = useSignal(true);
  const drafting = useSignal(false);

  const draft = useSignal<OutlineDraft | null>(null);
  const tree = useSignal<PlanTree>([]);
  const startDate = useSignal("");
  const createOutcomes = useSignal(true);
  const overviewPages = useSignal(false);
  const draftQuestions = useSignal(false);
  const creating = useSignal(false);
  const result = useSignal<PlanCreateResult | null>(null);

  if (!canManage || !aiOn) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {aiOn ? "Only the course's teachers can plan the course." : "AI assistance is turned off for your school."}
        </CardContent>
      </Card>
    );
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.value.trim() || !level.value.trim()) {
      toast.error("Give the subject and the level");
      return;
    }
    const n = parseWhole(length.value, 1, lengthMode.value === "weeks" ? 52 : 20);
    const a = parseWhole(assessments.value, 0, 100);
    drafting.value = true;
    try {
      const out = await aiCourseApi.outline(course.id, {
        subject: subject.value.trim(),
        level: level.value.trim(),
        ...(n !== null ? { [lengthMode.value]: n } : {}),
        ...(goals.value.trim() ? { goals: goals.value } : {}),
        ...(syllabus.value.trim() ? { syllabus: syllabus.value } : {}),
        ...(a !== null ? { assessments: a } : {}),
        mix: mix.value,
        outcomes: wantOutcomes.value,
        groups: useGroups.value,
      });
      draft.value = out;
      tree.value = fromDraft(out.plan.modules);
      startDate.value = out.startDate ?? "";
      result.value = null;
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      drafting.value = false;
    }
  }

  async function create() {
    const problems = planProblems(tree.value);
    if (problems.length) {
      toast.error(problems[0]);
      return;
    }
    const counts = countSelected(tree.value);
    if (!counts.modules) {
      toast.error("Tick at least one module to create");
      return;
    }
    creating.value = true;
    try {
      const out = await aiCourseApi.createPlan(
        course.id,
        toCreateBody(tree.value, {
          ...(startDate.value ? { startDate: startDate.value } : {}),
          createOutcomes: createOutcomes.value,
          overviewPages: overviewPages.value,
          draftQuestions: draftQuestions.value,
        }),
      );
      result.value = out;
      if (out.ok) toast.success(planResultSummary(out));
      else toast.warning(planResultSummary(out));
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      creating.value = false;
    }
  }

  const counts = countSelected(tree.value);
  const hasOutcomes = tree.value.some((m) => m.outcomes.length > 0);
  const hasQuizzes = tree.value.some((m) => m.items.some((i) => i.kind === "quiz"));

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Plan this course with AI"
        description="Describe the course; the AI drafts modules, pages, assignments and quizzes for you to edit. Nothing is created until you choose."
        actions={
          <Button variant="ghost" nativeButton={false} render={<Link href={`${base}/modules`} />}>
            <ArrowLeft className="mr-1.5 size-4" aria-hidden />
            Modules
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About the course</CardTitle>
          <CardDescription>
            Only what you type here and the course&apos;s name and description are sent to your organisation&apos;s AI provider. No student
            data is sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void generate(e)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-subject`}>Subject</Label>
                <Input id={`${id}-subject`} maxLength={200} value={subject.value} onChange={(e) => (subject.value = e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-level`}>Level or grade</Label>
                <Input id={`${id}-level`} maxLength={100} placeholder="e.g. Year 9, Grade 4" value={level.value} onChange={(e) => (level.value = e.target.value)} required />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-length`}>Length</Label>
                <Input id={`${id}-length`} type="number" min={1} max={lengthMode.value === "weeks" ? 52 : 20} value={length.value} onChange={(e) => (length.value = e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-mode`}>Counted in</Label>
                <NativeSelect id={`${id}-mode`} value={lengthMode.value} onChange={(e) => (lengthMode.value = e.target.value as "weeks" | "units")}>
                  <NativeSelectOption value="weeks">Weeks</NativeSelectOption>
                  <NativeSelectOption value="units">Units (modules)</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-assess`}>Assessments (about)</Label>
                <Input id={`${id}-assess`} type="number" min={0} max={100} placeholder="Any" value={assessments.value} onChange={(e) => (assessments.value = e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-mix`}>Mix</Label>
                <NativeSelect id={`${id}-mix`} value={mix.value} onChange={(e) => (mix.value = e.target.value as OutlineMix)}>
                  {OUTLINE_MIXES.map((m) => (
                    <NativeSelectOption key={m} value={m}>
                      {OUTLINE_MIX_LABEL[m]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-goals`}>Goals (optional)</Label>
              <Textarea id={`${id}-goals`} rows={3} maxLength={4000} value={goals.value} onChange={(e) => (goals.value = e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-syllabus`}>Syllabus or scheme of work (optional, pasted)</Label>
              <Textarea id={`${id}-syllabus`} rows={6} maxLength={30000} value={syllabus.value} onChange={(e) => (syllabus.value = e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-6">
              <span className="flex items-center gap-2">
                <Checkbox id={`${id}-outcomes`} checked={wantOutcomes.value} onCheckedChange={(v) => (wantOutcomes.value = v === true)} />
                <Label htmlFor={`${id}-outcomes`} className="font-normal">
                  Suggest learning outcomes (when mastery is on)
                </Label>
              </span>
              <span className="flex items-center gap-2">
                <Checkbox id={`${id}-groups`} checked={useGroups.value} onCheckedChange={(v) => (useGroups.value = v === true)} />
                <Label htmlFor={`${id}-groups`} className="font-normal">
                  Use assignment groups
                </Label>
              </span>
            </div>
            <Button type="submit" disabled={drafting.value}>
              {drafting.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 size-4" aria-hidden />}
              {drafting.value ? "Planning… (this can take a minute)" : draft.value ? "Draft a new plan" : "Draft a plan"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {draft.value && !result.value && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The plan</CardTitle>
            <CardDescription>
              Rename, remove, reorder and add as you like. Only ticked modules and items are created, all unpublished.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AiDraftNote>Check every title, instruction and point value. Nothing is created until you press Create selected.</AiDraftNote>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => (tree.value = selectAll(tree.value, true))}>
                Select all
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => (tree.value = selectAll(tree.value, false))}>
                Select none
              </Button>
            </div>
            <PlanTreeEditor tree={tree.value} onChangeAction={(t) => (tree.value = t)} groupNames={draft.value.existingGroups} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = addModule(tree.value);
                if (next) tree.value = next;
                else toast.error("A plan has at most 20 modules");
              }}
            >
              <Plus className="mr-1 size-4" aria-hidden />
              Add a module
            </Button>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-start`}>Due dates count from</Label>
                <Input id={`${id}-start`} type="date" className="w-48" value={startDate.value} onChange={(e) => (startDate.value = e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  {startDate.value
                    ? "Each assessment is due at the end of its week's first day (23:59 UTC). Clear the date to create them without due dates."
                    : "The course has no term start date: assessments are created without due dates unless you give one."}
                </p>
              </div>
              {hasOutcomes && draft.value.masteryOn && (
                <span className="flex items-center gap-2">
                  <Checkbox id={`${id}-mkout`} checked={createOutcomes.value} onCheckedChange={(v) => (createOutcomes.value = v === true)} />
                  <Label htmlFor={`${id}-mkout`} className="font-normal">
                    Create the ticked outcomes and align them to the assessments
                  </Label>
                </span>
              )}
              <span className="flex items-center gap-2">
                <Checkbox id={`${id}-overview`} checked={overviewPages.value} onCheckedChange={(v) => (overviewPages.value = v === true)} />
                <Label htmlFor={`${id}-overview`} className="font-normal">
                  Add an overview page to each module
                </Label>
              </span>
              {hasQuizzes && (
                <span className="flex items-center gap-2">
                  <Checkbox id={`${id}-dq`} checked={draftQuestions.value} onCheckedChange={(v) => (draftQuestions.value = v === true)} />
                  <Label htmlFor={`${id}-dq`} className="font-normal">
                    Also draft questions (quizzes are created empty; you then draft and accept questions in each quiz builder)
                  </Label>
                </span>
              )}
            </div>

            <Button type="button" onClick={() => void create()} disabled={creating.value || counts.modules === 0}>
              {creating.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
              {creating.value
                ? "Creating…"
                : `Create selected (${counts.modules} module${counts.modules === 1 ? "" : "s"}, ${counts.items} item${counts.items === 1 ? "" : "s"})`}
            </Button>
          </CardContent>
        </Card>
      )}

      {result.value && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{result.value.ok ? "Created" : "Created, with problems"}</CardTitle>
            <CardDescription>{planResultSummary(result.value)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PlanCreateReport result={result.value} base={base} />
            <div className="flex flex-wrap gap-2">
              <Button nativeButton={false} render={<Link href={`${base}/modules`} />}>Go to modules</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
