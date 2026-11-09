"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  courseLtiApi,
  formatCustomParams,
  parseCustomParams,
  type LtiItemDetail,
} from "@/lib/lti";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** An external tool item's settings: its tool, gradebook column and custom parameters. */
export function ExternalToolDialog({
  open,
  courseId,
  itemId,
  itemTitle,
  canEdit,
  onOpenChangeAction,
}: {
  open: boolean;
  courseId: string;
  itemId: string;
  itemTitle: string;
  canEdit: boolean;
  onOpenChangeAction: (open: boolean) => void;
}) {
  useSignals();
  const detail = useSignal<LtiItemDetail | null>(null);
  const text = useSignal("");
  const saving = useSignal(false);
  const url = `${courseLtiApi(courseId)}/items/${encodeURIComponent(itemId)}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<LtiItemDetail>(url)
      .then((d) => {
        if (!live) return;
        detail.value = d;
        text.value = formatCustomParams(d.customParams);
      })
      .catch((err) => {
        if (!live) return;
        toast.error(userMessage(err, "Failed to load the tool settings"));
      });
    return () => {
      live = false;
    };
  }, [open, url, detail, text]);

  const parsed = parseCustomParams(text.value);

  async function save() {
    if (parsed.params === null) return toast.error(parsed.problem);
    saving.value = true;
    try {
      const d = await api<LtiItemDetail>(url, {
        method: "PATCH",
        body: { customParams: parsed.params },
      });
      detail.value = d;
      toast.success("Saved");
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{itemTitle}</DialogTitle>
          <DialogDescription>
            {detail.value
              ? `External tool: ${detail.value.toolName}${detail.value.toolEnabled ? "" : " (switched off by your organisation)"}`
              : "External tool"}
          </DialogDescription>
        </DialogHeader>
        {!detail.value ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {detail.value.lineItem
                ? `Scores from the tool go to a ${detail.value.lineItem.points}-point gradebook column.`
                : "This item has no gradebook column."}
            </p>
            <div className="space-y-2">
              <Label htmlFor={`lti-item-${itemId}-custom`}>Custom parameters</Label>
              <Textarea
                id={`lti-item-${itemId}-custom`}
                rows={4}
                className="font-mono text-xs"
                value={text.value}
                readOnly={!canEdit}
                onChange={(e) => (text.value = e.target.value)}
                aria-describedby={`lti-item-${itemId}-hint`}
              />
              <p id={`lti-item-${itemId}-hint`} className="text-xs text-muted-foreground">
                One name=value per line, sent to the tool on every launch.
              </p>
              {parsed.problem && (
                <p className="text-sm text-destructive" role="alert">
                  {parsed.problem}
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChangeAction(false)}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button onClick={save} disabled={!detail.value || !!parsed.problem || saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
