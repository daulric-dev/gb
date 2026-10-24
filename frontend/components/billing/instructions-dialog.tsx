"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Payment instructions for providers without a hosted checkout (manual). */
export function InstructionsDialog({
  instructions,
  onClose,
}: {
  instructions: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={instructions !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How to pay</DialogTitle>
          <DialogDescription>
            Your invoice has been issued. Follow these instructions to pay it;
            access continues as soon as the payment is recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
          {instructions}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Only follow provider redirects to http(s) URLs. */
export function safeRedirect(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    window.location.assign(parsed.toString());
    return true;
  } catch {
    return false;
  }
}
