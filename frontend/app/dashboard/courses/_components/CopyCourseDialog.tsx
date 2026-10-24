"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Copy, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CopiedCourse, Course } from "@/lib/courses/types";
import type { TermOption, YearOption } from "@/lib/courses/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CourseCalendarFields } from "./CourseCalendarFields";
import {
  CopyDateFields,
  copyDatesOf,
  EMPTY_DATE_CHOICE,
  type DateChoice,
} from "./CopyDateFields";

/**
 * Copy a course into a new draft course: everything a teacher built, none of
 * the class (students, work, marks, announcements, replies).
 */
export function CopyCourseDialog({
  course,
  years,
  terms,
}: {
  course: Pick<Course, "id" | "name" | "code">;
  years: YearOption[];
  terms: TermOption[];
}) {
  useSignals();
  const router = useRouter();

  const open = useSignal(false);
  const name = useSignal("");
  const code = useSignal("");
  const yearId = useSignal("");
  const termId = useSignal("");
  const dates = useSignal<DateChoice>(EMPTY_DATE_CHOICE);
  const saving = useSignal(false);

  function reset() {
    name.value = `${course.name} (copy)`;
    code.value = course.code ?? "";
    yearId.value = years.find((y) => y.is_active)?.id ?? "";
    termId.value = "";
    dates.value = EMPTY_DATE_CHOICE;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.value.trim()) {
      toast.error("Give the new course a name");
      return;
    }
    const dateFields = copyDatesOf(dates.value);
    if (typeof dateFields === "string") {
      toast.error(dateFields);
      return;
    }

    saving.value = true;
    try {
      const copy = await api<CopiedCourse>(`/courses/${course.id}/copy`, {
        method: "POST",
        body: {
          name: name.value.trim(),
          code: code.value.trim() || undefined,
          academicYearId: yearId.value || undefined,
          termId: termId.value || undefined,
          ...dateFields,
        },
      });
      toast.success(
        `Copied ${copy.copied.modules} modules and ${copy.copied.activities} activities into a draft course`,
      );
      open.value = false;
      router.push(`/dashboard/courses/${copy.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to copy");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog
      open={open.value}
      onOpenChange={(v) => {
        if (v) reset();
        open.value = v;
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Copy className="mr-2 size-4" />
        Copy course
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Copy {course.name}</DialogTitle>
            <DialogDescription>
              Modules, pages, activities, rubrics, assignment groups and
              discussion prompts are copied into a new draft course you teach.
              Students, work, marks and announcements stay behind; copied
              activities start as drafts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <Label htmlFor="copyName">Name</Label>
              <Input
                id="copyName"
                value={name.value}
                onChange={(e) => (name.value = e.target.value)}
                maxLength={200}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="copyCode">Code</Label>
              <Input
                id="copyCode"
                value={code.value}
                onChange={(e) => (code.value = e.target.value)}
                maxLength={30}
              />
            </div>
          </div>

          <CourseCalendarFields
            years={years}
            terms={terms}
            yearId={yearId.value}
            termId={termId.value}
            onChangeAction={(next) => {
              yearId.value = next.yearId;
              termId.value = next.termId;
            }}
          />

          <CopyDateFields
            value={dates.value}
            onChangeAction={(next) => (dates.value = next)}
            disabled={saving.value}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => (open.value = false)}
              disabled={saving.value}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Copy course
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
