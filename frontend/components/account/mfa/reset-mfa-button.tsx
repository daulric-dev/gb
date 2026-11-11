"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { resetUserMfa } from "./mfa-api";

/**
 * Organisation console: remove someone's authenticator app and recovery codes
 * (a lost phone), after a confirm and "Confirm it's you". They are emailed.
 */
export function ResetMfaButton({ userId, who }: { userId: string; who: string }) {
  useSignals();
  const busy = useSignal(false);

  async function reset() {
    if (
      !window.confirm(
        `Remove ${who}'s authenticator app and recovery codes? They will sign in with an emailed code and can set up a new app.`,
      )
    ) {
      return;
    }
    busy.value = true;
    try {
      await resetUserMfa(userId);
      toast.success(`Two-step verification reset for ${who}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 404
          ? `${who} has no authenticator app set up`
          : userMessage(err, "Could not reset two-step verification"),
      );
    } finally {
      busy.value = false;
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void reset()}
      disabled={busy.value}
      title="Reset two-step verification"
    >
      {busy.value ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
      <span className="sr-only sm:not-sr-only sm:ml-1.5">Reset two-step</span>
    </Button>
  );
}
