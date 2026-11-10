"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import {
  revokedMessage,
  revokeUserSessions,
} from "@/lib/organisation";
import { Button } from "@/components/ui/button";
import { userMessage } from "@/lib/errors";

/** Signs one user out of every device, after a confirm. */
export function SignOutSessionsButton({
  userId,
  who,
}: {
  userId: string;
  who: string;
}) {
  useSignals();
  const busy = useSignal(false);

  async function signOut() {
    if (!window.confirm(`Sign ${who} out of every device? They can sign in again.`)) {
      return;
    }
    busy.value = true;
    try {
      const res = await revokeUserSessions(userId);
      toast.success(revokedMessage(who, res?.revoked));
    } catch (err) {
      toast.error(userMessage(err, "Failed to sign out"));
    } finally {
      busy.value = false;
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      disabled={busy.value}
      title="Sign out all sessions"
    >
      {busy.value ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
      <span className="sr-only sm:not-sr-only sm:ml-1.5">Sign out sessions</span>
    </Button>
  );
}
