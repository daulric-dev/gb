"use client";

import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyRow } from "@/app/dashboard/email-domains/_components/CopyRow";

/**
 * The signing secret, shown once after create or rotate. It is stored
 * encrypted and never returned again.
 */
export function SecretOnceDialog({
  secret,
  webhookName,
  rotated,
  onCloseAction,
}: {
  secret: string | null;
  webhookName: string;
  rotated: boolean;
  onCloseAction: () => void;
}) {
  return (
    <Dialog open={!!secret} onOpenChange={(open) => !open && onCloseAction()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {rotated ? "New signing secret" : "Signing secret"}
          </DialogTitle>
          <DialogDescription>
            Copy the secret for &ldquo;{webhookName}&rdquo; into the receiving
            system now: you won&apos;t see it again. It verifies the
            X-GradeBook-Signature header on every delivery.
            {rotated && " The old secret stopped working immediately."}
          </DialogDescription>
        </DialogHeader>
        {secret && <CopyRow label="Secret" value={secret} note="Keep it private, like a password." />}
        <DialogFooter>
          <Button onClick={onCloseAction}>I&apos;ve copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
