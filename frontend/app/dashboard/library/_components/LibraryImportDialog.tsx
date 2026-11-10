"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, Loader2 } from "lucide-react";
import { api, apiQuery } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { Course } from "@/lib/courses/types";
import {
  formatBytes,
  importLabel,
  importPercent,
  isFinished,
  type LibraryImport,
  type LibraryItemDetail,
} from "@/lib/library";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  CopyDateFields,
  copyDatesOf,
  EMPTY_DATE_CHOICE,
  type DateChoice,
} from "@/app/dashboard/courses/_components/CopyDateFields";

const POLL_MS = 1500;

/**
 * Import a library version into one of your courses (modules appended) or a
 * new draft course. The server checks every file against your school's
 * upload limit first, then copies the files into your own storage in the
 * background; this shows the progress and links to the course when done.
 */
export function LibraryImportDialog({ item }: { item: LibraryItemDetail }) {
  useSignals();
  const { can } = usePermissions();
  const canCreate = can("course", "create");
  const open = useSignal(false);
  const courses = useSignal<Course[]>([]);
  const target = useSignal<"existing" | "new">("existing");
  const courseId = useSignal("");
  const newName = useSignal(item.title);
  const version = useSignal(String(item.latestVersion));
  const dates = useSignal<DateChoice>(EMPTY_DATE_CHOICE);
  const starting = useSignal(false);
  const job = useSignal<LibraryImport | null>(null);

  useEffect(() => {
    if (!open.value) return;
    apiQuery<Course[]>("/courses")
      .then((list) => {
        courses.value = list
          .filter((c) => c.role === "teacher" || c.role === "admin")
          .sort((a, b) => a.name.localeCompare(b.name));
        if (courses.value.length === 0 && canCreate) target.value = "new";
      })
      .catch(() => (courses.value = []));
  }, [open.value, courses, target, canCreate]);

  // Poll the running import until it finishes.
  const jobId = job.value?.id;
  const running = job.value && !isFinished(job.value.status);
  useEffect(() => {
    if (!jobId || !running) return;
    const timer = setInterval(() => {
      api<LibraryImport>(`/library/imports/${jobId}`)
        .then((j) => {
          job.value = j;
          if (j.status === "done") toast.success(`Imported ${item.title}`);
          if (j.status === "failed") toast.error(j.error ?? "The import failed");
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, running, job, item.title]);

  function reset() {
    job.value = null;
    starting.value = false;
    dates.value = EMPTY_DATE_CHOICE;
    version.value = String(item.latestVersion);
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const dateFields = copyDatesOf(dates.value);
    if (typeof dateFields === "string") {
      toast.error(dateFields);
      return;
    }
    const body: Record<string, unknown> = { ...dateFields, version: Number(version.value) };
    if (target.value === "existing") {
      if (!courseId.value) {
        toast.error("Choose a course to import into");
        return;
      }
      body.targetCourseId = courseId.value;
    } else {
      if (!newName.value.trim()) {
        toast.error("Give the new course a name");
        return;
      }
      body.newCourse = { name: newName.value.trim() };
    }
    starting.value = true;
    try {
      job.value = await api<LibraryImport>(`/library/items/${item.id}/import`, {
        method: "POST",
        body,
      });
    } catch (err) {
      toast.error(userMessage(err, "Failed to start the import"));
    } finally {
      starting.value = false;
    }
  }

  const chosen = item.versions.find((v) => String(v.version) === version.value);
  const j = job.value;

  return (
    <Dialog
      open={open.value}
      onOpenChange={(v) => {
        open.value = v;
        if (v) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Download className="mr-2 size-4" aria-hidden="true" />
        Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {j ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Importing {item.title}</DialogTitle>
              <DialogDescription>
                Files are copied into your own storage; the author&apos;s files
                are never shared with you.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm">{importLabel(j)}</p>
              <Progress value={importPercent(j)} aria-label="Import progress" />
            </div>
            {j.status === "failed" && j.error && (
              <p className="text-sm text-destructive">{j.error}</p>
            )}
            {j.status === "done" && j.notes.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {j.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              {j.status === "done" && j.targetCourseId && (
                <Button nativeButton={false} render={<Link href={`/dashboard/courses/${j.targetCourseId}/modules`} />}>
                  Open the course
                </Button>
              )}
              <Button variant="outline" onClick={() => (open.value = false)}>
                {isFinished(j.status) ? "Close" : "Continue in the background"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={start} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Import {item.title}</DialogTitle>
              <DialogDescription>
                Modules go after your course&apos;s own and activities arrive as
                drafts. No student data, marks or submissions are ever included.
              </DialogDescription>
            </DialogHeader>

            {item.versions.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="importVersion">Version</Label>
                <NativeSelect
                  id="importVersion"
                  className="w-full"
                  value={version.value}
                  onChange={(e) => (version.value = e.target.value)}
                >
                  {item.versions.map((v) => (
                    <NativeSelectOption key={v.version} value={String(v.version)}>
                      Version {v.version}
                      {v.version === item.latestVersion ? " (latest)" : ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Import into</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="importTarget"
                  checked={target.value === "existing"}
                  onChange={() => (target.value = "existing")}
                />
                One of my courses
              </label>
              {target.value === "existing" && (
                <NativeSelect
                  aria-label="Course"
                  className="w-full"
                  value={courseId.value}
                  onChange={(e) => (courseId.value = e.target.value)}
                >
                  <NativeSelectOption value="">Choose a course…</NativeSelectOption>
                  {courses.value.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.code ? `${c.name} (${c.code})` : c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              {canCreate && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="importTarget"
                    checked={target.value === "new"}
                    onChange={() => (target.value = "new")}
                  />
                  A new draft course
                </label>
              )}
              {target.value === "new" && (
                <Input
                  aria-label="New course name"
                  value={newName.value}
                  maxLength={200}
                  onChange={(e) => (newName.value = e.target.value)}
                />
              )}
            </fieldset>

            <CopyDateFields
              value={dates.value}
              onChangeAction={(v) => (dates.value = v)}
              disabled={starting.value}
            />

            {chosen && chosen.fileCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {chosen.fileCount} file{chosen.fileCount === 1 ? "" : "s"} (
                {formatBytes(chosen.fileBytes)}) will be copied into your files.
                Each must fit your school&apos;s upload limit.
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => (open.value = false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={starting.value}>
                {starting.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
