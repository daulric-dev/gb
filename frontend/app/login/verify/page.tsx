"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MailCheck } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const RESEND_COOLDOWN = 60;
const CODE_LENGTH = 8;

/**
 * Bigger than the default slot - this is the only thing on the page to fill
 * in - but eight of them plus a separator have to fit inside the card at phone
 * width, which is what sets the smaller step.
 */
const SLOT = "size-9 text-base font-medium sm:size-11 sm:text-xl";

function VerifyOtpForm() {
  useSignals();
  const router = useRouter();
  const { refresh } = useAuth();
  const searchParams = useSearchParams();
  const email = searchParams?.get("email") || "";

  const code = useSignal("");
  const loading = useSignal(false);
  const resending = useSignal(false);
  const cooldown = useSignal(0);
  const error = useSignal<string | null>(null);

  const verify = useCallback(async () => {
    if (code.value.length !== CODE_LENGTH || loading.value) return;

    loading.value = true;
    error.value = null;

    try {
      const data = await api<{
        user: {
          is_onboarded: boolean;
          account_type: "staff" | "student" | null;
          first_name: string | null;
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { email, token: code.value },
      });

      await refresh();

      const isStudent = data.user.account_type === "student";

      if (data.user.is_onboarded) {
        router.push(isStudent ? "/portal" : "/dashboard");
      } else if (data.user.first_name) {
        // Named but school-less: they still have to join one. Sending them
        // back to /onboard would just loop.
        router.push("/schools");
      } else {
        router.push("/onboard");
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Verification failed";
      // Shown in place rather than only as a toast: the toast disappears, and
      // the next thing they do is retype the code right here.
      error.value = message;
      code.value = "";
    } finally {
      loading.value = false;
    }
  }, [code, email, error, loading, refresh, router]);

  // Submitting is the obvious next step once the last digit lands, so do it
  // rather than making them reach for the button.
  useEffect(() => {
    if (code.value.length === CODE_LENGTH) void verify();
  }, [code.value, verify]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    cooldown.value = RESEND_COOLDOWN;
    timerRef.current = setInterval(() => {
      cooldown.value -= 1;
      if (cooldown.value <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleResend() {
    resending.value = true;
    try {
      await api("/auth/otp/send", { method: "POST", body: { email } });
      toast.success("New code sent to your email");
      code.value = "";
      error.value = null;
      startCooldown();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to resend code",
      );
    } finally {
      resending.value = false;
    }
  }

  if (!email) {
    router.push("/login");
    return null;
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-6 px-4 py-8 sm:px-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <MailCheck className="size-6 text-muted-foreground" />
        </div>

        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Enter your code
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent an 8-digit code to
          </p>
          <p className="text-sm font-medium break-all">{email}</p>
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          <InputOTP
            maxLength={CODE_LENGTH}
            value={code.value}
            autoFocus
            disabled={loading.value}
            aria-invalid={!!error.value}
            onChange={(v) => {
              code.value = v;
              if (error.value) error.value = null;
            }}
          >
            {/* aria-invalid goes on each slot: that is what the slot styles
                key off, and the red boxes are the cue people actually see. */}
            <InputOTPGroup>
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className={SLOT}
                  aria-invalid={!!error.value}
                />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator className="hidden sm:flex" />
            <InputOTPGroup>
              {[4, 5, 6, 7].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className={SLOT}
                  aria-invalid={!!error.value}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {/* Reserved height, so the layout does not jump when an error lands. */}
          <p
            className="min-h-5 text-center text-sm text-destructive"
            role="alert"
          >
            {error.value}
          </p>
        </div>

        <Button
          className="w-full"
          onClick={() => void verify()}
          disabled={loading.value || code.value.length !== CODE_LENGTH}
        >
          {loading.value && <Loader2 className="mr-2 size-4 animate-spin" />}
          {loading.value ? "Verifying" : "Verify"}
        </Button>

        <div className="flex flex-col items-center gap-1 text-sm">
          <p className="text-muted-foreground">
            Didn&apos;t get it?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={resending.value || cooldown.value > 0}
              className="font-medium text-foreground underline underline-offset-4 disabled:no-underline disabled:opacity-60"
            >
              {resending.value
                ? "Sending…"
                : cooldown.value > 0
                  ? `Resend in ${cooldown.value}s`
                  : "Resend code"}
            </button>
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Use a different email
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function VerifyContent() {
  return (
    <AuthPageShell>
      <VerifyOtpForm />
    </AuthPageShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
