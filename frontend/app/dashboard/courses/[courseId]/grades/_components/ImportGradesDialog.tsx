"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AlertCircle, FileUp, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { GradebookImportPlan } from "@/lib/courses/types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mark = { score: number | null; excused: boolean } | null;

function markText(mark: Mark): string {
  if (!mark) return "-";
  if (mark.excused) return "EX";
  return mark.score === null ? "-" : String(mark.score);
}

/**
 * Bulk marking from a spreadsheet: pick a CSV in the export's shape, see
 * exactly what would change, then import. The server plans again on import,
 * so nothing here is trusted beyond the file itself.
 */
export function ImportGradesDialog({
  open,
  courseId,
  onOpenChangeAction,
  onImportedAction,
}: {
  open: boolean;
  courseId: string;
  onOpenChangeAction: (open: boolean) => void;
  onImportedAction: () => void;
}) {
  useSignals();
  const fileInput = useRef<HTMLInputElement>(null);
  const csv = useSignal<string | null>(null);
  const fileName = useSignal("");
  const plan = useSignal<GradebookImportPlan | null>(null);
  const working = useSignal(false);

  function reset() {
    csv.value = null;
    fileName.value = "";
    plan.value = null;
    if (fileInput.current) fileInput.current.value = "";
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      toast.error("That file is too large (1 MB at most)");
      return;
    }
    working.value = true;
    try {
      const text = await file.text();
      const preview = await api<GradebookImportPlan>(
        `/courses/${courseId}/gradebook/import/preview`,
        { method: "POST", body: { csv: text } },
      );
      csv.value = text;
      fileName.value = file.name;
      plan.value = preview;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not read that file");
      reset();
    } finally {
      working.value = false;
    }
  }

  async function apply() {
    if (!csv.value) return;
    working.value = true;
    try {
      const result = await api<{ applied: number }>(
        `/courses/${courseId}/gradebook/import`,
        { method: "POST", body: { csv: csv.value } },
      );
      toast.success(
        result.applied === 1 ? "1 mark imported" : `${result.applied} marks imported`,
      );
      reset();
      onImportedAction();
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      working.value = false;
    }
  }

  const p = plan.value;
  const matched = p?.columns.filter((c) => c.status === "activity").length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChangeAction(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import marks</DialogTitle>
          <DialogDescription>
            Upload a CSV in the shape of Export CSV. Students are matched by
            Student ID (or email, or name), columns by activity title. Blank
            cells are skipped, a number sets the mark, and EX excuses.
            Unchanged cells, quiz scores included, are left alone.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />

        {!p ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={working.value}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-sm text-muted-foreground hover:bg-muted/50"
          >
            {working.value ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <FileUp className="size-6" />
            )}
            Choose a CSV file
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{fileName.value}</span>
              : {p.matchedRows} of {p.rowCount} rows matched, {matched}{" "}
              {matched === 1 ? "activity column" : "activity columns"},{" "}
              {p.unchanged} cells unchanged.
            </p>

            {p.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>
                  {p.errors.length === 1
                    ? "1 problem to fix before importing"
                    : `${p.errors.length} problems to fix before importing`}
                </AlertTitle>
                <AlertDescription>
                  <ul className="max-h-32 list-disc space-y-0.5 overflow-auto pl-4">
                    {p.errors.map((e, i) => (
                      <li key={i}>
                        Line {e.line}
                        {e.column ? `, ${e.column}` : ""}: {e.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {p.changes.length === 0 ? (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                Nothing in this file would change a mark.
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Student</th>
                      <th className="px-3 py-1.5 font-medium">Activity</th>
                      <th className="px-3 py-1.5 text-right font-medium">Now</th>
                      <th className="px-3 py-1.5 text-right font-medium">New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.changes.map((c) => (
                      <tr key={`${c.studentId}-${c.activityId}`} className="border-t">
                        <td className="px-3 py-1.5">{c.studentName}</td>
                        <td className="px-3 py-1.5">{c.activityTitle}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                          {markText(c.from)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {markText(c.to)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {p && (
            <Button variant="ghost" onClick={reset} disabled={working.value}>
              Choose another file
            </Button>
          )}
          <Button
            onClick={apply}
            disabled={
              working.value || !p || p.errors.length > 0 || p.changes.length === 0
            }
          >
            {working.value && p && <Loader2 className="mr-2 size-4 animate-spin" />}
            {p && p.changes.length > 0
              ? `Import ${p.changes.length} ${p.changes.length === 1 ? "mark" : "marks"}`
              : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
