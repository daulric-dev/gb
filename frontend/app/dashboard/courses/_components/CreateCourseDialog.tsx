"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  CopiedCourse,
  Course,
  CourseTemplate,
} from "@/lib/courses/types";
import type { TermOption, YearOption } from "@/lib/courses/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { CourseCalendarFields } from "./CourseCalendarFields";
import {
  CopyDateFields,
  copyDatesOf,
  EMPTY_DATE_CHOICE,
  type DateChoice,
} from "./CopyDateFields";

const BLANK = "blank";

export function CreateCourseDialog({
  years,
  terms,
}: {
  years: YearOption[];
  terms: TermOption[];
}) {
  useSignals();
  const router = useRouter();

  const open = useSignal(false);
  const name = useSignal("");
  const code = useSignal("");
  const description = useSignal("");
  const yearId = useSignal("");
  const termId = useSignal("");
  const saving = useSignal(false);
  // "Start from a template": the school's templates, loaded when the dialog
  // opens; BLANK is an empty course.
  const templates = useSignal<CourseTemplate[]>([]);
  const templateId = useSignal(BLANK);
  const dates = useSignal<DateChoice>(EMPTY_DATE_CHOICE);

  function reset() {
    templateId.value = BLANK;
    dates.value = EMPTY_DATE_CHOICE;
    api<CourseTemplate[]>("/courses/templates")
      .then((data) => (templates.value = data))
      .catch(() => (templates.value = []));
    name.value = "";
    code.value = "";
    description.value = "";
    // Most new courses belong to the year that is running now.
    yearId.value = years.find((y) => y.is_active)?.id ?? "";
    termId.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.value.trim()) {
      toast.error("Give the course a name");
      return;
    }

    if (templateId.value !== BLANK) {
      await createFromTemplate(templateId.value);
      return;
    }

    saving.value = true;
    try {
      const course = await api<Course>("/courses", {
        method: "POST",
        body: {
          name: name.value.trim(),
          code: code.value.trim() || undefined,
          description: description.value.trim() || undefined,
          academicYearId: yearId.value || undefined,
          termId: termId.value || undefined,
        },
      });
      toast.success("Course created as a draft");
      open.value = false;
      router.push(`/dashboard/courses/${course.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      saving.value = false;
    }
  }

  /** Copy the template into a new draft course the caller teaches. */
  async function createFromTemplate(id: string) {
    const dateFields = copyDatesOf(dates.value);
    if (typeof dateFields === "string") {
      toast.error(dateFields);
      return;
    }
    saving.value = true;
    try {
      const course = await api<CopiedCourse>(`/courses/${id}/copy`, {
        method: "POST",
        body: {
          name: name.value.trim(),
          code: code.value.trim() || undefined,
          academicYearId: yearId.value || undefined,
          termId: termId.value || undefined,
          ...dateFields,
        },
      });
      toast.success("Course created from the template as a draft");
      open.value = false;
      router.push(`/dashboard/courses/${course.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create");
    } finally {
      saving.value = false;
    }
  }

  const fromTemplate = templateId.value !== BLANK;
  const templateItems = [
    { value: BLANK, label: "Blank course" },
    ...templates.value.map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <Dialog
      open={open.value}
      onOpenChange={(v) => {
        if (v) reset();
        open.value = v;
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        New course
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New course</DialogTitle>
            <DialogDescription>
              You become its teacher. It stays a draft, hidden from students,
              until you publish it.
            </DialogDescription>
          </DialogHeader>

          {templates.value.length > 0 && (
            <div className="space-y-2">
              <Label>Start from a template</Label>
              <Select
                value={templateId.value}
                onValueChange={(v) => (templateId.value = v as string)}
                items={templateItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templateItems.map((t) => {
                    const tpl = templates.value.find((x) => x.id === t.value);
                    return (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                        {tpl && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tpl.moduleCount} modules · {tpl.activityCount}{" "}
                            activities
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-2">
              <Label htmlFor="courseName">Name</Label>
              <Input
                id="courseName"
                placeholder="Biology - Form 4"
                value={name.value}
                onChange={(e) => (name.value = e.target.value)}
                maxLength={200}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="courseCode">Code</Label>
              <Input
                id="courseCode"
                placeholder="BIO4"
                value={code.value}
                onChange={(e) => (code.value = e.target.value)}
                maxLength={30}
              />
            </div>
          </div>

          {!fromTemplate && (
            <div className="space-y-2">
              <Label htmlFor="courseDescription">Description</Label>
              <Textarea
                id="courseDescription"
                rows={3}
                placeholder="What the course covers. Markdown works."
                value={description.value}
                onChange={(e) => (description.value = e.target.value)}
              />
            </div>
          )}

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

          {fromTemplate && (
            <CopyDateFields
              value={dates.value}
              onChangeAction={(next) => (dates.value = next)}
              disabled={saving.value}
            />
          )}

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
              Create course
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
