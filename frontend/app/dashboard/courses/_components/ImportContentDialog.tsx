"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  CopyCounts,
  Course,
  CourseTemplate,
} from "@/lib/courses/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CopyDateFields,
  copyDatesOf,
  EMPTY_DATE_CHOICE,
  type DateChoice,
} from "./CopyDateFields";

interface SourceOption {
  value: string;
  label: string;
  name: string;
}

const COUNT_LABELS: [keyof CopyCounts, string][] = [
  ["modules", "modules"],
  ["moduleItems", "module items"],
  ["pages", "pages"],
  ["activities", "activities"],
  ["quizQuestions", "quiz questions"],
  ["rubrics", "rubrics"],
  ["assignmentGroups", "assignment groups"],
  ["discussionTopics", "discussion topics"],
];

/**
 * Append another course's content (one the caller teaches or runs, or a
 * school template) to this course. Its modules land after this course's own;
 * activities arrive as drafts; groups with the same name are merged.
 */
export function ImportContentDialog({
  course,
  onImportedAction,
}: {
  course: Pick<Course, "id" | "name">;
  onImportedAction: () => void | Promise<void>;
}) {
  useSignals();

  const open = useSignal(false);
  const step = useSignal<"choose" | "confirm" | "done">("choose");
  const loading = useSignal(false);
  const sources = useSignal<SourceOption[]>([]);
  const sourceId = useSignal("");
  const dates = useSignal<DateChoice>(EMPTY_DATE_CHOICE);
  const saving = useSignal(false);
  const result = useSignal<CopyCounts | null>(null);

  async function load() {
    loading.value = true;
    const [mine, templates] = await Promise.all([
      api<Course[]>("/courses").catch(() => [] as Course[]),
      api<CourseTemplate[]>("/courses/templates").catch(
        () => [] as CourseTemplate[],
      ),
    ]);
    const templateIds = new Set(templates.map((t) => t.id));
    const own = mine
      .filter(
        (c) =>
          c.id !== course.id &&
          !templateIds.has(c.id) &&
          (c.role === "teacher" || c.role === "admin"),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        value: c.id,
        name: c.name,
        label: c.code ? `${c.name} (${c.code})` : c.name,
      }));
    const tpl = templates
      .filter((t) => t.id !== course.id)
      .map((t) => ({
        value: t.id,
        name: t.name,
        label: `${t.name} - template, ${t.moduleCount} modules`,
      }));
    sources.value = [...own, ...tpl];
    loading.value = false;
  }

  function reset() {
    step.value = "choose";
    sourceId.value = "";
    dates.value = EMPTY_DATE_CHOICE;
    result.value = null;
    void load();
  }

  const source = sources.value.find((s) => s.value === sourceId.value);

  function next(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceId.value) {
      toast.error("Choose a course to import from");
      return;
    }
    const dateFields = copyDatesOf(dates.value);
    if (typeof dateFields === "string") {
      toast.error(dateFields);
      return;
    }
    step.value = "confirm";
  }

  async function runImport() {
    const dateFields = copyDatesOf(dates.value);
    if (typeof dateFields === "string") return;
    saving.value = true;
    try {
      const res = await api<{ copied: CopyCounts }>(
        `/courses/${course.id}/import`,
        {
          method: "POST",
          body: { sourceCourseId: sourceId.value, ...dateFields },
        },
      );
      result.value = res.copied;
      step.value = "done";
      toast.success(`Imported content from ${source?.name ?? "the course"}`);
      await onImportedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to import");
      step.value = "choose";
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog
      open={open.value}
      onOpenChange={(v) => {
        if (saving.value) return;
        if (v) reset();
        open.value = v;
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Download className="mr-2 size-4" />
        Import content
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {step.value === "choose" && (
          <form onSubmit={next} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import content into {course.name}</DialogTitle>
              <DialogDescription>
                Copy the modules, pages, activities, rubrics, assignment groups
                and discussion prompts of another course into this one. Nothing
                here is replaced: imported modules go after your own, and
                imported activities start as drafts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Import from</Label>
              {loading.value ? (
                <Skeleton className="h-8 w-full" />
              ) : sources.value.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  No other courses you teach, and no school templates.
                </p>
              ) : (
                <Select
                  value={sourceId.value || null}
                  onValueChange={(v) => (sourceId.value = (v as string) ?? "")}
                  items={sources.value}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a course or template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.value.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <CopyDateFields
              value={dates.value}
              onChangeAction={(n) => (dates.value = n)}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (open.value = false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!sourceId.value}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step.value === "confirm" && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import from {source?.name}?</DialogTitle>
              <DialogDescription>
                Everything in {source?.name} is added to {course.name}. This
                can&apos;t be undone in one step: imported items have to be
                removed one by one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => (step.value = "choose")}
                disabled={saving.value}
              >
                Back
              </Button>
              <Button onClick={runImport} disabled={saving.value}>
                {saving.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Import content
              </Button>
            </DialogFooter>
          </div>
        )}

        {step.value === "done" && result.value && (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Content imported</DialogTitle>
              <DialogDescription>
                From {source?.name}. Review the new draft activities and
                publish them when they are ready.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {COUNT_LABELS.map(([key, label]) => (
                <li
                  key={key}
                  className="flex items-baseline justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">
                    {result.value![key]}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => (open.value = false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
