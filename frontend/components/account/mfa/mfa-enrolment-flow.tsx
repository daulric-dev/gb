"use client";

import { useEffect, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/errors";
import {
  confirmMfaEnrolment,
  MFA_CODE_LENGTH,
  startMfaEnrolment,
  type MfaEnrolment,
} from "./mfa-api";
import { MfaCodeInput } from "./mfa-code-input";
import { RecoveryCodes } from "./recovery-codes";

/** Groups of four, easier to type into an app by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Set up (or move) an authenticator app: starts as it mounts (after "Confirm
 * it's you"), shows the QR code and the key, takes a code from the app, then
 * shows the recovery codes once. `onDone` after they confirm they saved them.
 */
export function MfaEnrolmentFlow({
  onDone,
  onCancel,
  cancelLabel = "Cancel",
}: {
  onDone: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  useSignals();
  const enrolment = useSignal<MfaEnrolment | null>(null);
  const failed = useSignal<string | null>(null);
  const code = useSignal("");
  const error = useSignal<string | null>(null);
  const verifying = useSignal(false);
  const recoveryCodes = useSignal<string[] | null>(null);
  const saved = useSignal(false);
  // One secret per mount: a second start would replace the one on screen.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startMfaEnrolment()
      .then((data) => (enrolment.value = data))
      .catch((err) => (failed.value = userMessage(err, "Could not start setting up")));
  }, [enrolment, failed]);

  async function verify(value: string) {
    if (value.length !== MFA_CODE_LENGTH || verifying.value) return;
    verifying.value = true;
    error.value = null;
    try {
      const res = await confirmMfaEnrolment(value);
      recoveryCodes.value = res.recoveryCodes;
      toast.success("Authenticator app added");
    } catch (err) {
      error.value = userMessage(err, "That code did not work");
      code.value = "";
    } finally {
      verifying.value = false;
    }
  }

  if (failed.value) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive" role="alert">
          {failed.value}
        </p>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel === "Cancel" ? "Back" : cancelLabel}
          </Button>
        )}
      </div>
    );
  }

  if (recoveryCodes.value) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-medium">Save your recovery codes</h3>
          <p className="text-sm text-muted-foreground">
            If you lose your phone, each of these signs you in once instead of
            a code from the app. Keep them somewhere safe, away from your phone.
            They are shown only now.
          </p>
        </div>
        <RecoveryCodes codes={recoveryCodes.value} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved.value}
            onChange={(e) => (saved.value = e.target.checked)}
          />
          I have saved these codes
        </label>
        <Button type="button" disabled={!saved.value} onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const data = enrolment.value;
  if (!data) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Skeleton className="size-44" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator, 1Password or Aegis).</li>
        <li>Scan this QR code, or type the key in by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="rounded-lg border bg-white p-3">
          <QRCodeSVG value={data.otpauthUri} size={160} level="M" aria-label="QR code for your authenticator app" />
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-muted-foreground">Key</p>
          <p className="break-all font-mono font-medium" translate="no">
            {grouped(data.secret)}
          </p>
          <p className="text-muted-foreground">
            Account: <span className="text-foreground">{data.account}</span>, time-based, 6 digits.
          </p>
        </div>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code.value);
        }}
      >
        <MfaCodeInput
          value={code.value}
          invalid={!!error.value}
          disabled={verifying.value}
          onChange={(v) => {
            code.value = v;
            if (error.value) error.value = null;
            if (v.length === MFA_CODE_LENGTH) void verify(v);
          }}
        />
        <p className="min-h-5 text-sm text-destructive" role="alert">
          {error.value}
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={verifying.value || code.value.length !== MFA_CODE_LENGTH}>
            {verifying.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Verify
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={verifying.value}>
              {cancelLabel}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
