"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarClock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { formatDue } from "@/lib/courses/format";
import {
  extendedLabel,
  extensionRequest,
  suggestedExtensionInput,
} from "@/lib/courses/extensions";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StudentExtension, SubmissionRow } from "./types";

/** "Extended to …" under a student's name on the roster. */
export function ExtensionBadge({
  extension,
}: {
  extension?: StudentExtension | null;
}) {
  if (!extension) return null;
  return (
    <Badge
      variant="outline"
      className="mt-1 gap-1 text-xs font-normal"
      title={extension.reason ?? undefined}
      data-private-label
    >
      <CalendarClock className="size-3" />
      {extendedLabel(extension.dueAt)}
    </Badge>
  );
}

/**
 * The roster's per-student due date action: extend (or change) the student's
 * due date, or remove their extension. `onChangedAction` gets the row back
 * with its new extension and effective due date.
 */
export function ExtensionActions({
  activityId,
  activityDueAt,
  row,
  onChangedAction,
}: {
  activityId: string;
  activityDueAt: string | null;
  row: SubmissionRow;
  onChangedAction: (row: SubmissionRow) => void;
}) {
  useSignals();
  const open = useSignal(false);
  const dueInput = useSignal("");
  const reason = useSignal("");
  const working = useSignal(false);
  const extension = row.extension ?? null;
  const path = `/activities/${activityId}/extensions/${row.studentId}`;

  function openDialog() {
    dueInput.value = suggestedExtensionInput(extension?.dueAt, activityDueAt);
    reason.value = extension?.reason ?? "";
    open.value = true;
  }

  async function save() {
    const checked = extensionRequest(dueInput.value, reason.value);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    working.value = true;
    try {
      const saved = await api<StudentExtension>(path, {
        method: "PUT",
        body: checked.body,
      });
      onChangedAction({
        ...row,
        extension: saved,
        effectiveDueAt: saved.dueAt,
      });
      toast.success(`${row.name} now has until ${formatDue(saved.dueAt)}`);
      open.value = false;
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the extension"));
    } finally {
      working.value = false;
    }
  }

  async function remove() {
    working.value = true;
    try {
      await api(path, { method: "DELETE" });
      onChangedAction({
        ...row,
        extension: null,
        effectiveDueAt: activityDueAt,
      });
      toast.success(`Removed ${row.name}'s extension`);
      open.value = false;
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove the extension"));
    } finally {
      working.value = false;
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              title="Due date"
              aria-label={`Due date for ${row.name}`}
              data-private-label
              disabled={working.value}
            />
          }
        >
          <CalendarClock className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={openDialog}>
            {extension ? "Change extension" : "Extend due date"}
          </DropdownMenuItem>
          {extension && (
            <DropdownMenuItem onClick={() => void remove()}>
              Remove extension
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open.value}
        onOpenChange={(v) => {
          if (!v) open.value = false;
        }}
      >
        <DialogContent translate="no">
          <DialogHeader>
            <DialogTitle>Extend due date for {row.name}</DialogTitle>
            <DialogDescription>
              {activityDueAt
                ? `Everyone else is due ${formatDue(activityDueAt)}.`
                : "This has no due date for the rest of the class."}{" "}
              Only {row.name} gets the new date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="extensionDue" className="text-xs">
                New due date
              </Label>
              <Input
                id="extensionDue"
                type="datetime-local"
                value={dueInput.value}
                onChange={(e) => (dueInput.value = e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="extensionReason" className="text-xs">
                Reason (optional)
              </Label>
              <Textarea
                id="extensionReason"
                rows={3}
                maxLength={500}
                placeholder="Off sick for the week"
                value={reason.value}
                onChange={(e) => (reason.value = e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (open.value = false)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={working.value}>
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {extension ? "Save extension" : "Extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
