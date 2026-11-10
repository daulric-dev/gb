"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2, RotateCw, X } from "lucide-react";
import {
  inviteExpired,
  inviteExpiryLabel,
  resendInvite,
  revokeInvite,
  type InviteSummary,
} from "@/lib/organisation";
import { Button } from "@/components/ui/button";
import { userMessage } from "@/lib/errors";

/**
 * Resend (14 more days, emailed again) and Cancel for one open invite.
 * `onChanged` runs after either succeeds, so the caller reloads.
 */
export function InviteActions({
  invite,
  onChanged,
}: {
  invite: InviteSummary;
  onChanged: () => void;
}) {
  useSignals();
  const busySignal = useSignal<"resend" | "cancel" | null>(null);
  const busy = busySignal.value;

  async function resend() {
    busySignal.value = "resend";
    try {
      await resendInvite(invite.id);
      toast.success(`Invite to ${invite.email} sent again`);
      onChanged();
    } catch (err) {
      toast.error(userMessage(err, "Failed to resend the invite"));
    } finally {
      busySignal.value = null;
    }
  }

  async function cancel() {
    if (!window.confirm(`Cancel the invite to ${invite.email}?`)) return;
    busySignal.value = "cancel";
    try {
      await revokeInvite(invite.id);
      toast.success(`Invite to ${invite.email} cancelled`);
      onChanged();
    } catch (err) {
      toast.error(userMessage(err, "Failed to cancel the invite"));
    } finally {
      busySignal.value = null;
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        onClick={resend}
        disabled={busy !== null}
        title="Send the invite again, with 14 more days"
      >
        {busy === "resend" ? (
          <Loader2 className="animate-spin" />
        ) : (
          <RotateCw />
        )}
        Resend
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={cancel}
        disabled={busy !== null}
        title="Cancel the invite"
      >
        {busy === "cancel" ? <Loader2 className="animate-spin" /> : <X />}
        Cancel
      </Button>
    </span>
  );
}

/** "Invited: x@y (expires …)" with Resend / Cancel, for a school with no admin yet. */
export function PendingAdminInvite({
  invite,
  onChanged,
}: {
  invite: InviteSummary;
  onChanged: () => void;
}) {
  const expired = inviteExpired(invite);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      <span className="truncate">
        Invited: {invite.email}{" "}
        <span className={expired ? "text-destructive" : "text-muted-foreground"}>
          ({inviteExpiryLabel(invite)})
        </span>
      </span>
      <InviteActions invite={invite} onChanged={onChanged} />
    </span>
  );
}
