"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { customSecretProblem, rotateBody, type WebhookWithSecret } from "@/lib/webhooks";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SecretInput } from "./secret-input";

/**
 * Rotate a webhook's signing secret: a generated one (shown once after), or
 * the admin's own (not echoed back). Effective at once. Needs step-up.
 */
export function RotateSecretDialog({
  open,
  url,
  webhookName,
  onOpenChangeAction,
  onRotatedAction,
}: {
  open: boolean;
  /** The webhook's API path. */
  url: string;
  webhookName: string;
  onOpenChangeAction: (open: boolean) => void;
  onRotatedAction: (result: WebhookWithSecret) => void;
}) {
  useSignals();
  const own = useSignal("");
  const saving = useSignal(false);
  const problem = own.value ? customSecretProblem(own.value) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    saving.value = true;
    try {
      const r = await api<WebhookWithSecret>(`${url}/rotate-secret`, {
        method: "POST",
        body: rotateBody(own.value),
        stepUp: true,
      });
      if (!r.secretGenerated) toast.success("Your signing secret is saved");
      onRotatedAction(r);
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(userMessage(err, "Failed to rotate the secret"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              Rotate signing secret
            </DialogTitle>
            <DialogDescription>
              The current secret for &ldquo;{webhookName}&rdquo; stops working immediately: update
              the receiver straight after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rotate-own-secret">Use my own signing secret (optional)</Label>
            <SecretInput
              id="rotate-own-secret"
              value={own.value}
              maxLength={256}
              placeholder="Leave blank to generate one"
              label="signing secret"
              onChangeAction={(v) => (own.value = v)}
            />
            <p className="text-xs text-muted-foreground">
              16-256 characters. A generated secret is shown once; your own is stored encrypted and
              not shown again.
            </p>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Rotate secret
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
