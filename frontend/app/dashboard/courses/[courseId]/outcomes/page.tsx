"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Archive, ArchiveRestore, Download, Link2, Loader2, Plus, Target, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import {
  cellDescription,
  cellText,
  nestOutcomes,
  type AlignmentTarget,
  type CourseOutcomes,
  type MasteryGrid,
  type Outcome,
} from "@/lib/mastery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScaleLegend, toneClass } from "@/components/mastery/mastery-ui";
import { cn } from "@/lib/utils";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { AiOutcomeSuggestions } from "./_components/AiOutcomeSuggestions";
import { useFeatures } from "@/hooks/use-features";

/**
 * A course's learning outcomes: the mastery grid (students × outcomes) and,
 * for the teacher, the course's own outcomes and what each is linked to
 * (whole activities, rubric rows, quiz questions). Alongside the points
 * gradebook; nothing here changes a grade.
 */
export default function CourseOutcomesPage() {
  useSignals();
  const { course } = useCourse();
  const tab = useSignal<"grid" | "manage">("grid");
  const grid = useSignal<MasteryGrid | null>(null);
  const setup = useSignal<CourseOutcomes | null>(null);
  const exporting = useSignal(false);

  async function load() {
    try {
      const [g, s] = await Promise.all([
        api<MasteryGrid>(`/courses/${course.id}/mastery`),
        api<CourseOutcomes>(`/courses/${course.id}/outcomes`),
      ]);
      grid.value = g;
      setup.value = s;
    } catch (err) {
      toast.error(userMessage(err, "Failed to load outcomes"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  async function exportCsv() {
    exporting.value = true;
    try {
      await downloadFromUrl(`/courses/${course.id}/mastery/export`, "mastery.csv");
    } catch (err) {
      toast.error(userMessage(err, "Could not export"));
    } finally {
      exporting.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Outcomes"
        description="Mastery of learning outcomes, alongside the points gradebook."
        actions={
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting.value || !grid.value}>
            {exporting.value ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
            Export CSV
          </Button>
        }
      />
      <Tabs value={tab.value} onValueChange={(v) => (tab.value = v as "grid" | "manage")}>
        <TabsList>
          <TabsTrigger value="grid">Mastery</TabsTrigger>
          <TabsTrigger value="manage">Outcomes &amp; links</TabsTrigger>
        </TabsList>
        <TabsContent value="grid" className="pt-4">
          {grid.value ? <GridView grid={grid.value} base={`/dashboard/courses/${course.id}/outcomes`} /> : <Skeleton className="h-48 w-full" />}
        </TabsContent>
        <TabsContent value="manage" className="pt-4">
          {setup.value ? <ManageView courseId={course.id} data={setup.value} onChange={load} /> : <Skeleton className="h-48 w-full" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GridView({ grid, base }: { grid: MasteryGrid; base: string }) {
  if (grid.outcomes.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Target />
          </EmptyMedia>
          <EmptyTitle>No outcomes yet</EmptyTitle>
          <EmptyDescription>
            Add course outcomes or link school outcomes to activities, rubric rows or quiz questions under
            &ldquo;Outcomes &amp; links&rdquo;. Marks then become evidence automatically.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="space-y-4">
      <ScaleLegend scale={grid.scale} />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Mastery per student and outcome. Each cell shows the level label and score.
          </caption>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                Student
              </th>
              {grid.outcomes.map((o) => (
                <th key={o.id} scope="col" className="min-w-32 px-2 py-2 text-left align-bottom font-medium">
                  <span className="block font-mono text-xs" title={o.title}>
                    {o.code}
                  </span>
                  <span className="block max-w-40 truncate text-xs font-normal text-muted-foreground">{o.title}</span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Mastered
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.students.map((s) => (
              <tr key={s.id} className="border-t">
                <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal">
                  <Link href={`${base}/students/${s.id}`} className="underline-offset-2 hover:underline">
                    {[s.lastName, s.firstName].filter(Boolean).join(", ") || "Unnamed"}
                  </Link>
                </th>
                {s.cells.map((c) => {
                  const o = grid.outcomes.find((x) => x.id === c.outcomeId)!;
                  return (
                    <td key={c.outcomeId} className="px-2 py-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
                          toneClass(c.level, grid.scale),
                        )}
                        aria-label={cellDescription(c, o)}
                      >
                        {cellText(c)}
                        {c.mastered && <span aria-hidden>✓</span>}
                        {c.status === "needs_more_evidence" && <span aria-hidden>…</span>}
                      </span>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-xs">
                  {s.masteredCount} of {grid.outcomes.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">✓ mastered · … at the mastery level but needs more evidence</p>
    </div>
  );
}

type TargetChoice = { value: string; label: string };

function targetChoices(targets: AlignmentTarget[]): { group: string; options: TargetChoice[] }[] {
  return targets.map((t) => ({
    group: t.title,
    options: [
      { value: `activity:${t.id}`, label: `${t.title} (whole ${t.kind === "quiz" ? "quiz" : "activity"})` },
      ...(t.rubric?.criteria ?? []).map((c) => ({ value: `criterion:${c.id}`, label: `Rubric row: ${c.title}` })),
      ...t.questions.map((q, i) => ({
        value: `question:${q.id}`,
        label: `Question ${i + 1}: ${q.prompt.length > 60 ? `${q.prompt.slice(0, 60)}…` : q.prompt}`,
      })),
    ],
  }));
}

function ManageView({ courseId, data, onChange }: { courseId: string; data: CourseOutcomes; onChange: () => Promise<void> }) {
  useSignals();
  const { hasFeature } = useFeatures();
  const aiOn = hasFeature("ai_assistance");
  const code = useSignal("");
  const title = useSignal("");
  const parentId = useSignal("");
  const outcomeId = useSignal("");
  const target = useSignal("");
  const busy = useSignal(false);

  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    busy.value = true;
    try {
      await action();
      toast.success(done);
      await onChange();
    } catch (err) {
      toast.error(userMessage(err, failed));
    } finally {
      busy.value = false;
    }
  }

  function addOutcome(e: React.FormEvent) {
    e.preventDefault();
    if (!code.value.trim() || !title.value.trim()) return;
    void run(
      () =>
        api(`/courses/${courseId}/outcomes`, {
          method: "POST",
          body: { code: code.value.trim(), title: title.value.trim(), parentId: parentId.value || null },
        }),
      "Outcome added",
      "Could not add the outcome",
    ).then(() => {
      code.value = "";
      title.value = "";
    });
  }

  function link(e: React.FormEvent) {
    e.preventDefault();
    const [kind, id] = target.value.split(":");
    if (!outcomeId.value || !id) return;
    const key = kind === "activity" ? "activityId" : kind === "criterion" ? "criterionId" : "questionId";
    void run(
      () => api(`/courses/${courseId}/outcome-alignments`, { method: "POST", body: { outcomeId: outcomeId.value, [key]: id } }),
      "Linked. Existing marks now count as evidence.",
      "Could not link",
    );
  }

  const own = nestOutcomes(data.own);
  const activeOwn = data.own.filter((o) => !o.archived);
  const bySet = new Map<string, (Outcome & { setTitle: string | null })[]>();
  for (const o of data.school.filter((x) => !x.archived)) {
    const k = o.setTitle ?? "School outcomes";
    bySet.set(k, [...(bySet.get(k) ?? []), o]);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
          <CardDescription>
            Each marked submission becomes evidence for the outcomes its activity, rubric rows or quiz questions are
            linked to. Late penalties never count. Removing a link removes the evidence it produced.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.canEdit && (
            <form onSubmit={link} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="align-outcome">Outcome</Label>
                <NativeSelect id="align-outcome" value={outcomeId.value} onChange={(e) => (outcomeId.value = e.target.value)}>
                  <NativeSelectOption value="">Choose an outcome</NativeSelectOption>
                  {activeOwn.length > 0 && (
                    <NativeSelectOptGroup label="This course">
                      {activeOwn.map((o) => (
                        <NativeSelectOption key={o.id} value={o.id}>
                          {o.code} {o.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  )}
                  {[...bySet].map(([set, list]) => (
                    <NativeSelectOptGroup key={set} label={set}>
                      {list.map((o) => (
                        <NativeSelectOption key={o.id} value={o.id}>
                          {o.code} {o.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="align-target">Measured by</Label>
                <NativeSelect id="align-target" value={target.value} onChange={(e) => (target.value = e.target.value)}>
                  <NativeSelectOption value="">Choose an activity, rubric row or question</NativeSelectOption>
                  {targetChoices(data.targets).map((g) => (
                    <NativeSelectOptGroup key={g.group} label={g.group}>
                      {g.options.map((o) => (
                        <NativeSelectOption key={o.value} value={o.value}>
                          {o.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelectOptGroup>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={busy.value || !outcomeId.value || !target.value}>
                <Link2 className="mr-2 size-4" aria-hidden />
                Link
              </Button>
            </form>
          )}
          {data.alignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is linked yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.alignments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p>
                      <span className="font-mono text-xs text-muted-foreground">{a.outcomeCode}</span> {a.outcomeTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.kind === "activity" ? "Whole activity" : a.kind === "criterion" ? "Rubric row" : "Quiz question"}: {a.label}
                    </p>
                  </div>
                  {data.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy.value}
                      aria-label={`Remove the link between ${a.outcomeCode} and ${a.label}`}
                      onClick={() =>
                        void run(
                          () => api(`/courses/${courseId}/outcome-alignments/${a.id}`, { method: "DELETE" }),
                          "Link removed",
                          "Could not remove the link",
                        )
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Course outcomes</CardTitle>
          <CardDescription>
            Outcomes for this course only. School frameworks are managed by your school admin under Settings → Mastery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {own.length === 0 ? (
            <p className="text-sm text-muted-foreground">This course has no outcomes of its own.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {own.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  style={{ paddingLeft: `${0.75 + o.depth * 1.25}rem` }}
                >
                  <p className={cn(o.archived && "text-muted-foreground line-through")}>
                    <span className="font-mono text-xs">{o.code}</span> {o.title}
                    {o.archived && <span className="sr-only"> (archived)</span>}
                  </p>
                  {data.canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy.value}
                        aria-label={`${o.archived ? "Restore" : "Archive"} ${o.code}`}
                        onClick={() =>
                          void run(
                            () => api(`/courses/${courseId}/outcomes/${o.id}`, { method: "PATCH", body: { archived: !o.archived } }),
                            o.archived ? "Restored" : "Archived",
                            "Could not update the outcome",
                          )
                        }
                      >
                        {o.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy.value}
                        aria-label={`Delete ${o.code}`}
                        onClick={() =>
                          void run(
                            () => api(`/courses/${courseId}/outcomes/${o.id}`, { method: "DELETE" }),
                            "Deleted",
                            "Could not delete. An outcome with evidence can only be archived.",
                          )
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.canEdit && (
            <form onSubmit={addOutcome} className="grid gap-3 md:grid-cols-[8rem_1fr_12rem_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="outcome-code">Code</Label>
                <Input id="outcome-code" value={code.value} maxLength={64} onChange={(e) => (code.value = e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outcome-title">Outcome</Label>
                <Input id="outcome-title" value={title.value} maxLength={500} onChange={(e) => (title.value = e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="outcome-parent">Inside</Label>
                <NativeSelect id="outcome-parent" value={parentId.value} onChange={(e) => (parentId.value = e.target.value)}>
                  <NativeSelectOption value="">Top level</NativeSelectOption>
                  {activeOwn.map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.code}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={busy.value || !code.value.trim() || !title.value.trim()}>
                <Plus className="mr-2 size-4" aria-hidden />
                Add
              </Button>
            </form>
          )}
          {data.canEdit && aiOn && <AiOutcomeSuggestions courseId={courseId} onAddedAction={onChange} />}
        </CardContent>
      </Card>
    </div>
  );
}
