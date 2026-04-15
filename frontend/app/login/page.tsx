"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

function LoginEmailForm() {
  useSignals();
  const router = useRouter();
  const email = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/auth/otp/send", {
        method: "POST",
        body: { email: email.value },
      });
      toast.success("OTP sent to your email");
      router.push(`/login/verify?email=${encodeURIComponent(email.value)}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to send OTP";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign in to GradeBook</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a one-time code
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="teacher@school.com"
              value={email.value}
              onChange={(e) => (email.value = e.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading.value}>
            {loading.value ? "Sending..." : "Send OTP"}
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-3">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <AuthPageShell>
      <LoginEmailForm />
    </AuthPageShell>
  );
}
