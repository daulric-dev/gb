"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Course } from "@/lib/courses/types";
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
import { CourseCalendarFields } from "./CourseCalendarFields";

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

  function reset() {
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
