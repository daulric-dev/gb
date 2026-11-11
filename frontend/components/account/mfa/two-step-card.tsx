"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { userMessage } from "@/lib/errors";
import {
  disableMfa,
  getMfaStatus,
  MFA_CODE_LENGTH,
  regenerateRecoveryCodes,
  type MfaStatus,
} from "./mfa-api";
import { MfaCodeInput } from "./mfa-code-input";
import { MfaEnrolmentFlow } from "./mfa-enrolment-flow";
import { RecoveryCodes } from "./recovery-codes";

/**
 * "Two-step verification" on the account page: set up, move or turn off an
 * authenticator app, and make new recovery codes. Changes ask "Confirm it's
 * you" first.
 */
export function TwoStepCard() {
  useSignals();
  const status = useSignal<MfaStatus | null>(null);
  const failed = useSignal(false);
  const enrolling = useSignal(false);
  const newCodes = useSignal<string[] | null>(null);
  const regenerating = useSignal(false);
  const disableOpen = useSignal(false);
  const disableCode = useSignal("");
  const useRecovery = useSignal(false);
  const recoveryCode = useSignal("");
  const disabling = useSignal(false);
  const disableError = useSignal<string | null>(null);

  const load = useCallback(() => {
    getMfaStatus()
      .then((s) => {
        status.value = s;
        failed.value = false;
      })
      .catch(() => (failed.value = true));
  }, [status, failed]);

  useEffect(() => {
    load();
  }, [load]);

  async function regenerate() {
    if (!window.confirm("Make new recovery codes? The old ones stop working.")) return;
    regenerating.value = true;
    try {
      const res = await regenerateRecoveryCodes();
      newCodes.value = res.recoveryCodes;
      load();
    } catch (err) {
      toast.error(userMessage(err, "Could not make new recovery codes"));
    } finally {
      regenerating.value = false;
    }
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    disabling.value = true;
    disableError.value = null;
    try {
      await disableMfa(
        useRecovery.value
          ? { recoveryCode: recoveryCode.value.trim() }
          : { code: disableCode.value },
      );
      disableOpen.value = false;
      toast.success("Two-step verification is off");
      load();
    } catch (err) {
      disableError.value = userMessage(err, "Could not turn it off");
    } finally {
      disabling.value = false;
    }
  }

  const s = status.value;

  return (
    <Card className="space-y-4 p-6" id="two-step">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="size-5" />
            Two-step verification
          </h2>
          <p className="text-sm text-muted-foreground">
            After the emailed code, also ask for a code from an authenticator
            app on your phone. Someone who gets into your email still cannot
            sign in.
          </p>
        </div>
        {s?.enabled ? <Badge>On</Badge> : s ? <Badge variant="outline">Off</Badge> : null}
      </div>

      {failed.value ? (
        <p className="text-sm text-muted-foreground">
          Two-step verification settings could not be loaded.
        </p>
      ) : !s ? (
        <Skeleton className="h-9 w-48" />
      ) : enrolling.value ? (
        <MfaEnrolmentFlow
          onDone={() => {
            enrolling.value = false;
            load();
          }}
          onCancel={() => (enrolling.value = false)}
        />
      ) : newCodes.value ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your new recovery codes. The old ones no longer work. They are shown only now.
          </p>
          <RecoveryCodes codes={newCodes.value} />
          <Button type="button" onClick={() => (newCodes.value = null)}>
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {s.required && (
            <p className="text-sm">
              Your organisation requires an authenticator app for your role.
            </p>
          )}
          {s.enabled ? (
            <>
              <p className="text-sm text-muted-foreground">
                On since {s.enabledAt ? new Date(s.enabledAt).toLocaleDateString() : "—"}.{" "}
                {s.recoveryCodesRemaining} of 10 recovery codes left.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => (enrolling.value = true)}>
                  Move to a new phone
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void regenerate()}
                  disabled={regenerating.value}
                >
                  {regenerating.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  New recovery codes
                </Button>
                {!s.required && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      disableCode.value = "";
                      recoveryCode.value = "";
                      useRecovery.value = false;
                      disableError.value = null;
                      disableOpen.value = true;
                    }}
                  >
                    Turn off
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button type="button" onClick={() => (enrolling.value = true)}>
              Set up authenticator app
            </Button>
          )}
        </div>
      )}

      <Dialog open={disableOpen.value} onOpenChange={(o) => !disabling.value && (disableOpen.value = o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn off two-step verification?</DialogTitle>
            <DialogDescription>
              Signing in will need only the emailed code. Enter a code from your
              authenticator app to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={turnOff} className="space-y-3">
            {useRecovery.value ? (
              <div className="space-y-2">
                <Label htmlFor="disable-recovery">Recovery code</Label>
                <Input
                  id="disable-recovery"
                  autoComplete="off"
                  value={recoveryCode.value}
                  onChange={(e) => (recoveryCode.value = e.target.value)}
                  placeholder="xxxxx-xxxxx"
                />
              </div>
            ) : (
              <MfaCodeInput
                value={disableCode.value}
                autoFocus
                invalid={!!disableError.value}
                onChange={(v) => {
                  disableCode.value = v;
                  disableError.value = null;
                }}
              />
            )}
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => (useRecovery.value = !useRecovery.value)}
            >
              {useRecovery.value ? "Use a code from the app" : "Use a recovery code instead"}
            </button>
            <p className="min-h-5 text-sm text-destructive" role="alert">
              {disableError.value}
            </p>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  disabling.value ||
                  (useRecovery.value
                    ? recoveryCode.value.trim().length < 10
                    : disableCode.value.length !== MFA_CODE_LENGTH)
                }
              >
                {disabling.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Turn off
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
