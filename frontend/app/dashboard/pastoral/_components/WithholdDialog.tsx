"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { sarWithheldRequest, type PastoralNote } from "@/lib/pastoral";
import { Button } from "@/components/ui/button";
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

/**
 * Withhold a pastoral note from data requests (subject access exports) with
 * the exemption relied on, or release it again. Audited by the API.
 */
export function WithholdDialog({
  note,
  onOpenChangeAction,
  onSavedAction,
}: {
  note: PastoralNote;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: () => void;
}) {
  useSignals();
  const reason = useSignal("");
  const saving = useSignal(false);
  const withholding = !note.sarWithheld;
  const body = sarWithheldRequest(withholding, reason.value);

  async function save() {
    if (!body) return;
    saving.value = true;
    try {
      await api(`/pastoral/notes/${note.id}/sar-withheld`, { method: "PATCH", body, stepUp: true });
      toast.success(withholding ? "Withheld from data requests" : "Included in data requests again");
      onOpenChangeAction(false);
      onSavedAction();
    } catch (err) {
      toast.error(userMessage(err, "Could not change the note"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChangeAction}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{withholding ? "Withhold from data requests" : "Include in data requests"}</DialogTitle>
          <DialogDescription>
            {withholding
              ? "The note is left out of data downloads made for the student (subject access requests). Only do this under an exemption, for example where disclosure would put someone at risk or reveal another person. Staff downloads show how many notes were withheld."
              : "The note will be included in data downloads made for the student again."}
          </DialogDescription>
        </DialogHeader>
        {withholding ? (
          <div className="space-y-2">
            <Label htmlFor="withhold-reason">Reason (the exemption relied on)</Label>
            <Textarea
              id="withhold-reason"
              value={reason.value}
              maxLength={2000}
              rows={4}
              onChange={(e) => (reason.value = e.target.value)}
              placeholder="e.g. Disclosure would be likely to cause serious harm"
            />
            <p className="text-xs text-muted-foreground">Recorded in the audit log.</p>
          </div>
        ) : (
          note.sarWithheldReason && (
            <p className="text-sm">
              <span className="text-muted-foreground">Withheld because: </span>
              {note.sarWithheldReason}
            </p>
          )
        )}
        <DialogFooter>
          <Button disabled={saving.value || !body} onClick={() => void save()}>
            {saving.value && <Loader2 className="size-4 animate-spin" />}
            {withholding ? "Withhold" : "Include again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
