"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

const RESEND_COOLDOWN = 60;

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.value.length !== 8) return;
    loading.value = true;

    try {
      const data = await api<{
        user: {
          is_onboarded: boolean;
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { email, token: code.value },
      });

      // call refresh after login
      await refresh();

      if (data.user.is_onboarded) {
        router.push("/dashboard");
      } else {
        router.push("/onboard");
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Verification failed";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
    code.value = text;
  }

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
      await api("/auth/otp/send", {
        method: "POST",
        body: { email },
      });
      toast.success("New code sent to your email");
      code.value = "";
      startCooldown();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to resend code";
      toast.error(message);
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
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Enter your code</CardTitle>
        <CardDescription>
          We sent an 8-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex justify-center">
            <InputOTP maxLength={8} value={code.value} onChange={(v) => (code.value = v)} onPaste={onPaste}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading.value || code.value.length !== 8}
          >
            {loading.value ? "Verifying..." : "Verify"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={resending.value || cooldown.value > 0}
            onClick={handleResend}
          >
            {resending.value
              ? "Sending..."
              : cooldown.value > 0
                ? `Resend code (${cooldown.value}s)`
                : "Resend code"
            }
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.push("/login")}
          >
            Back to login
          </Button>
        </form>
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