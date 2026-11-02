"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import {
  errorMessage,
  revokedMessage,
  revokeUserSessions,
} from "@/lib/organisation";
import { Button } from "@/components/ui/button";

/** Signs one user out of every device, after a confirm. */
export function SignOutSessionsButton({
  userId,
  who,
}: {
  userId: string;
  who: string;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (!window.confirm(`Sign ${who} out of every device? They can sign in again.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await revokeUserSessions(userId);
      toast.success(revokedMessage(who, res?.revoked));
    } catch (err) {
      toast.error(errorMessage(err, "Failed to sign out"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      disabled={busy}
      title="Sign out all sessions"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <LogOut className="size-4" />
      )}
      <span className="sr-only sm:not-sr-only sm:ml-1.5">Sign out sessions</span>
    </Button>
  );
}
