"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Trash2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  accountOutcomeText,
  ERASED_ITEMS,
  eraseConfirmMatches,
  eraseConfirmWord,
  eraseStudent,
  getErasurePreview,
  KEPT_ITEMS,
  type LinkedAccountOutcome,
} from "@/lib/student-erasure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Danger zone on the student page (`student:erase`): erase the record for
 * good after reading what goes (the preview says what happens to the linked
 * account), typing the student's name and confirming it's you.
 */
export function EraseStudentCard({
  studentId,
  studentName,
  onErasedAction,
}: {
  studentId: string;
  studentName: string;
  onErasedAction: () => void;
}) {
  useSignals();
  const open = useSignal(false);
  const preview = useSignal<LinkedAccountOutcome | null>(null);
  const previewError = useSignal<string | null>(null);
  const typed = useSignal("");
  const erasing = useSignal(false);
  const word = eraseConfirmWord(studentName);

  function openDialog() {
    open.value = true;
    typed.value = "";
    preview.value = null;
    previewError.value = null;
    getErasurePreview(studentId)
      .then((p) => (preview.value = p.account))
      .catch((err) => (previewError.value = userMessage(err, "Could not check the linked account")));
  }

  async function erase() {
    erasing.value = true;
    try {
      await eraseStudent(studentId);
      toast.success("Student record erased");
      open.value = false;
      onErasedAction();
    } catch (err) {
      toast.error(userMessage(err, "Could not erase the record"));
    } finally {
      erasing.value = false;
    }
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Erase this student record and everything held about the student in this school, for
          good. Use it for an erasure request or when the record should never have existed; to
          keep the history, deactivate the student instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={openDialog}>
          <Trash2 className="size-4" />
          Erase student record
        </Button>
      </CardContent>

      <Dialog open={open.value} onOpenChange={(v) => (open.value = v)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Erase <span translate="no">{studentName || "this student"}</span>?
            </DialogTitle>
            <DialogDescription>This cannot be undone. It deletes:</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {ERASED_ITEMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">The sign-in account</p>
            {preview.value ? (
              <p className="text-muted-foreground">{accountOutcomeText(preview.value)}</p>
            ) : previewError.value ? (
              <p className="text-destructive">{previewError.value}</p>
            ) : (
              <Skeleton className="mt-1 h-4 w-3/4" />
            )}
          </div>
          <div className="text-sm">
            <p className="font-medium">Not deleted</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {KEPT_ITEMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <Label htmlFor="erase-confirm">
              Type <strong translate="no">{word}</strong> to confirm
            </Label>
            <Input
              id="erase-confirm"
              value={typed.value}
              onChange={(e) => (typed.value = e.target.value)}
              autoComplete="off"
              translate="no"
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={erasing.value || !preview.value || !eraseConfirmMatches(typed.value, studentName)}
              onClick={() => void erase()}
            >
              {erasing.value && <Loader2 className="size-4 animate-spin" />}
              Erase for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
