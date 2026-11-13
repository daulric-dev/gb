"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Mail } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  canAskForEmail,
  cancelEmailChange,
  cleanEmailCode,
  confirmEmailChange,
  EMAIL_CHANGE_CODE_LENGTH,
  getPendingEmailChange,
  requestEmailChange,
  type PendingEmailChange,
} from "@/lib/email-change";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The sign-in email address and "Change email": confirm it's you, enter the
 * new address, then the code mailed to it. The old address gets an alert and
 * every other device is signed out. Addresses on a domain whose school
 * requires single sign-on are refused by the API (its message is shown).
 */
export function ChangeEmail({
  current,
  onChangedAction,
}: {
  current: string | null | undefined;
  onChangedAction: (email: string) => void;
}) {
  useSignals();
  const pending = useSignal<PendingEmailChange | null>(null);
  const open = useSignal(false);
  const email = useSignal("");
  const code = useSignal("");
  const busy = useSignal(false);

  useEffect(() => {
    getPendingEmailChange()
      // A code that has run out is no use: start again with the address.
      .then((p) => (pending.value = p && new Date(p.expiresAt).getTime() > Date.now() ? p : null))
      .catch(() => (pending.value = null));
  }, [pending]);

  const live = pending.value;

  // The dialog renders in a portal, but React still bubbles its submit to the
  // profile form this sits in: stop it there.
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!canAskForEmail(email.value, current)) return;
    busy.value = true;
    try {
      pending.value = await requestEmailChange(email.value.trim());
      code.value = "";
      toast.success("We sent a code to the new address");
    } catch (err) {
      toast.error(userMessage(err, "Could not send the code"));
    } finally {
      busy.value = false;
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (code.value.length !== EMAIL_CHANGE_CODE_LENGTH) return;
    busy.value = true;
    try {
      const res = await confirmEmailChange(code.value);
      pending.value = null;
      open.value = false;
      email.value = "";
      code.value = "";
      toast.success("Email address changed");
      onChangedAction(res.email);
    } catch (err) {
      toast.error(userMessage(err, "That code did not work"));
    } finally {
      busy.value = false;
    }
  }

  async function cancel() {
    busy.value = true;
    try {
      await cancelEmailChange();
      pending.value = null;
      code.value = "";
    } catch (err) {
      toast.error(userMessage(err, "Could not cancel"));
    } finally {
      busy.value = false;
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="email" value={current || ""} disabled className="opacity-60" translate="no" />
        <Button type="button" variant="outline" onClick={() => (open.value = true)}>
          <Mail className="size-4" />
          Change email
        </Button>
      </div>
      {live ? (
        <p className="text-xs text-muted-foreground">
          Waiting for the code sent to <span translate="no">{live.email}</span>.{" "}
          <button type="button" className="underline" onClick={() => (open.value = true)}>
            Enter it
          </button>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">You sign in with this address.</p>
      )}

      <Dialog
        open={open.value}
        onOpenChange={(v) => {
          open.value = v;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change your email address</DialogTitle>
            <DialogDescription>
              We send a code to the new address to check it is yours. When you enter it, your old
              address gets an alert and you are signed out on every other device. If your school
              requires its single sign-on for that address, change it there instead.
            </DialogDescription>
          </DialogHeader>

          {!live ? (
            <form onSubmit={ask} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-email">New email address</Label>
                <Input
                  id="new-email"
                  type="email"
                  autoComplete="email"
                  value={email.value}
                  onChange={(e) => (email.value = e.target.value)}
                  translate="no"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You will be asked to confirm it&apos;s you first.
              </p>
              <DialogFooter>
                <Button type="submit" disabled={busy.value || !canAskForEmail(email.value, current)}>
                  {busy.value && <Loader2 className="size-4 animate-spin" />}
                  Send code
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={confirm} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-code">
                  Code sent to <span translate="no">{live.email}</span>
                </Label>
                <Input
                  id="email-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="12345678"
                  value={code.value}
                  onChange={(e) => (code.value = cleanEmailCode(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  It works for 15 minutes. Check spam if it hasn&apos;t arrived.
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" disabled={busy.value} onClick={() => void cancel()}>
                  Use a different address
                </Button>
                <Button type="submit" disabled={busy.value || code.value.length !== EMAIL_CHANGE_CODE_LENGTH}>
                  {busy.value && <Loader2 className="size-4 animate-spin" />}
                  Change email
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
