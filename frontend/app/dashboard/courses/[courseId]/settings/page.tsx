"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CourseStatus } from "@/lib/courses/types";
import {
  loadCalendar,
  type TermOption,
  type YearOption,
} from "@/lib/courses/calendar";
import type { GradeScaleSummary } from "@/app/dashboard/grade-scales/_components/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { MarkdownEditor } from "../_components/MarkdownEditor";
import { CourseCalendarFields } from "../../_components/CourseCalendarFields";

const STATUS_ITEMS: { value: CourseStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Draft", hint: "Hidden from students" },
  { value: "published", label: "Published", hint: "Enrolled students can see it" },
  { value: "archived", label: "Archived", hint: "Read-only, kept for the record" },
];

const DEFAULT_SCALE = "default";

export default function CourseSettingsPage() {
  useSignals();
  const router = useRouter();
  const { course, canManage, reload } = useCourse();

  const name = useSignal(course.name);
  const code = useSignal(course.code ?? "");
  const description = useSignal(course.description ?? "");
  const status = useSignal<CourseStatus>(course.status);
  const yearId = useSignal(course.academicYearId ?? "");
  const termId = useSignal(course.termId ?? "");
  const scaleId = useSignal(course.gradeScaleId ?? "");
  const saving = useSignal(false);
  const confirmDelete = useSignal(false);
  const deleting = useSignal(false);

  const years = useSignal<YearOption[]>([]);
  const terms = useSignal<TermOption[]>([]);
  const scales = useSignal<GradeScaleSummary[]>([]);

  useEffect(() => {
    void loadCalendar().then((cal) => {
      years.value = cal.years;
      terms.value = cal.terms;
    });
    api<GradeScaleSummary[]>("/grade-scales")
      .then((data) => (scales.value = data))
      .catch(() => (scales.value = []));
  }, [years, terms, scales]);

  if (!canManage) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center">
          <Lock className="mb-3 size-10 text-muted-foreground/40" />
          <p className="font-medium">Teachers only</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Only the course&apos;s teachers can change its settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.value.trim()) {
      toast.error("The course needs a name");
      return;
    }
    saving.value = true;
    try {
      await api(`/courses/${course.id}`, {
        method: "PATCH",
        body: {
          name: name.value.trim(),
          code: code.value.trim() || null,
          description: description.value.trim() || null,
          status: status.value,
          academicYearId: yearId.value || null,
          termId: termId.value || null,
          gradeScaleId: scaleId.value || null,
        },
      });
      toast.success("Settings saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  async function remove() {
    deleting.value = true;
    try {
      await api(`/courses/${course.id}`, { method: "DELETE" });
      toast.success("Course deleted");
      router.push("/dashboard/courses");
    } catch (err) {
      // 409: work has been handed in; the API says to archive first.
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
      confirmDelete.value = false;
    } finally {
      deleting.value = false;
    }
  }

  const defaultScale = scales.value.find((s) => s.isDefault);
  const scaleItems = [
    {
      value: DEFAULT_SCALE,
      label: defaultScale ? `School default (${defaultScale.name})` : "School default",
    },
    ...scales.value.map((s) => ({ value: s.id, label: s.name })),
  ];
  const statusItems = STATUS_ITEMS.map((s) => ({ value: s.value, label: s.label }));

  return (
    <div className="space-y-5">
      <SectionHeader title="Settings" description="Details, status and grading" />

      <form onSubmit={save} className="space-y-5">
        <Card className="animate-fade-in-up-delay-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-2">
                <Label htmlFor="settingsName">Name</Label>
                <Input
                  id="settingsName"
                  value={name.value}
                  onChange={(e) => (name.value = e.target.value)}
                  maxLength={200}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settingsCode">Code</Label>
                <Input
                  id="settingsCode"
                  value={code.value}
                  onChange={(e) => (code.value = e.target.value)}
                  maxLength={30}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <MarkdownEditor
                value={description.value}
                onChangeAction={(v) => (description.value = v)}
                rows={8}
                placeholder="Shown on the course home page"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up-delay-2">
          <CardHeader>
            <CardTitle>Status and calendar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status.value}
                onValueChange={(v) => (status.value = v as CourseStatus)}
                items={statusItems}
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_ITEMS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.hint}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CourseCalendarFields
              years={years.value}
              terms={terms.value}
              yearId={yearId.value}
              termId={termId.value}
              onChangeAction={(next) => {
                yearId.value = next.yearId;
                termId.value = next.termId;
              }}
            />
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up-delay-3">
          <CardHeader>
            <CardTitle>Grading</CardTitle>
            <CardDescription>
              The scale turns the course percentage into a letter. Weights are
              set per assignment group on the Assignments tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Grade scale</Label>
              <Select
                value={scaleId.value || DEFAULT_SCALE}
                onValueChange={(v) =>
                  (scaleId.value = v === DEFAULT_SCALE ? "" : (v as string))
                }
                items={scaleItems}
              >
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scaleItems.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete course</CardTitle>
          <CardDescription>
            Removes the course with its modules, pages and work. A course with
            handed-in work has to be archived first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => (confirmDelete.value = true)}
          >
            <Trash2 className="mr-2 size-4" />
            Delete course
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDelete.value}
        onOpenChange={(v) => (confirmDelete.value = v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {course.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Students lose access straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting.value}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={remove}
              disabled={deleting.value}
            >
              {deleting.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
