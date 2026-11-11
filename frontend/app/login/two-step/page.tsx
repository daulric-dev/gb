"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { KeyRound, Loader2 } from "lucide-react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { homePathFor, loginPath, NEXT_PARAM, safeNextPath } from "@/lib/routing";
import { useAuth } from "@/providers/AuthProvider";
import {
  MFA_CODE_LENGTH,
  takeChallenge,
  verifyMfaChallenge,
} from "@/components/account/mfa/mfa-api";
import { MfaCodeInput } from "@/components/account/mfa/mfa-code-input";

/** Errors after which this challenge is gone: only starting again helps. */
const FINAL = new Set(["MFA_CHALLENGE_EXPIRED", "MFA_LOCKED"]);

/**
 * The second sign-in step for accounts with an authenticator app: after the
 * emailed code (the token waits in sessionStorage) or single sign-on (the
 * token arrives in the URL and is moved out of it at once).
 */
function TwoStepForm() {
  useSignals();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, refresh } = useAuth();
  const next = safeNextPath(searchParams?.get(NEXT_PARAM));

  const token = useSignal<string | null>(null);
  const ready = useSignal(false);
  const code = useSignal("");
  const useRecovery = useSignal(false);
  const recoveryCode = useSignal("");
  const loading = useSignal(false);
  const error = useSignal<string | null>(null);
  const finished = useSignal(false);
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const fromUrl = searchParams?.get("token");
    token.value = fromUrl || takeChallenge();
    ready.value = true;
    if (fromUrl) {
      // Out of the address bar and history.
      const params = new URLSearchParams();
      if (next) params.set(NEXT_PARAM, next);
      const query = params.toString();
      window.history.replaceState(null, "", `/login/two-step${query ? `?${query}` : ""}`);
    }
  }, [searchParams, next, token, ready]);

  async function submit(value?: string) {
    const t = token.value;
    if (!t || loading.value || finished.value) return;
    const input = useRecovery.value
      ? { token: t, recoveryCode: recoveryCode.value.trim() }
      : { token: t, code: value ?? code.value };
    if (!useRecovery.value && input.code?.length !== MFA_CODE_LENGTH) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await verifyMfaChallenge(input);
      if (res.recoveryCodeUsed) {
        toast.warning(
          `Signed in with a recovery code. ${res.recoveryCodesRemaining} left: make new ones in your account settings.`,
        );
      }
      await refresh();
      const home = homePathFor(profile.value);
      const setupDone = home === "/portal" || home === "/dashboard" || home === "/parent";
      router.replace(setupDone && next ? next : home);
    } catch (err) {
      error.value = userMessage(err, "That code did not work");
      if (err instanceof ApiError && err.code && FINAL.has(err.code)) finished.value = true;
      code.value = "";
    } finally {
      loading.value = false;
    }
  }

  if (ready.value && !token.value) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 px-4 py-8 text-center sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">Sign-in expired</h1>
          <p className="text-sm text-muted-foreground">Start again to get a new emailed code.</p>
          <Button className="w-full" onClick={() => router.replace(loginPath(next))}>
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-6 px-4 py-8 sm:px-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <KeyRound className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
          <p className="text-sm text-muted-foreground">
            {useRecovery.value
              ? "Enter one of your recovery codes. Each works once."
              : "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>

        <form
          className="flex w-full flex-col items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {useRecovery.value ? (
            <Input
              aria-label="Recovery code"
              autoFocus
              autoComplete="off"
              placeholder="xxxxx-xxxxx"
              value={recoveryCode.value}
              disabled={loading.value || finished.value}
              onChange={(e) => {
                recoveryCode.value = e.target.value;
                if (error.value && !finished.value) error.value = null;
              }}
            />
          ) : (
            <MfaCodeInput
              value={code.value}
              autoFocus
              invalid={!!error.value}
              disabled={loading.value || finished.value}
              slotClassName="size-11 text-xl font-medium"
              onChange={(v) => {
                code.value = v;
                if (error.value && !finished.value) error.value = null;
                if (v.length === MFA_CODE_LENGTH) void submit(v);
              }}
            />
          )}
          <p className="min-h-5 text-center text-sm text-destructive" role="alert">
            {error.value}
          </p>
          {finished.value ? (
            <Button type="button" className="w-full" onClick={() => router.replace(loginPath(next))}>
              Start again
            </Button>
          ) : (
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading.value ||
                !ready.value ||
                (useRecovery.value
                  ? recoveryCode.value.trim().length < 10
                  : code.value.length !== MFA_CODE_LENGTH)
              }
            >
              {loading.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {loading.value ? "Verifying" : "Verify"}
            </Button>
          )}
        </form>

        <div className="flex flex-col items-center gap-1 text-sm">
          {!finished.value && (
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => {
                useRecovery.value = !useRecovery.value;
                error.value = null;
              }}
            >
              {useRecovery.value ? "Use a code from the app" : "Lost your phone? Use a recovery code"}
            </button>
          )}
          <button
            type="button"
            onClick={() => router.replace(loginPath(next))}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          No phone and no recovery codes? Ask your organisation&apos;s administrator to reset
          two-step verification on your account.
        </p>
      </CardContent>
    </Card>
  );
}

export default function TwoStepPage() {
  return (
    <Suspense>
      <AuthPageShell>
        <TwoStepForm />
      </AuthPageShell>
    </Suspense>
  );
}
