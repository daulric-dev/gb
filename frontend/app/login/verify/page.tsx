"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { setTokens } from "@/lib/auth";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

function VerifyOtpForm() {
  useSignals();
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const code = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.value.length !== 8) return;
    loading.value = true;

    try {
      const data = await api<{
        session: {
          access_token: string;
          refresh_token: string;
        };
        user: {
          is_onboarded: boolean;
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { email, token: code.value },
      });

      setTokens(data.session.access_token, data.session.refresh_token);

      if (data.user.is_onboarded) {
        router.push("/dashboard");
      } else {
        router.push("/onboard");
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Verification failed";
      toast.error(message);
    } finally {
      loading.value = false;
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
            <InputOTP maxLength={8} value={code.value} onChange={(v) => (code.value = v)}>
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
