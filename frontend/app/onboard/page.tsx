"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

export default function OnboardPage() {
  useSignals();

  const router = useRouter();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/auth/onboard", {
        method: "PATCH",
        body: {
          firstName: firstName.value,
          lastName: lastName.value,
        },
      });
      router.push("/schools");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Onboarding failed";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  return (
    <AuthPageShell>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Complete your profile</CardTitle>
          <CardDescription>
            Tell us a bit about yourself to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName.value}
                  onChange={(e) => (firstName.value = e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName.value}
                  onChange={(e) => (lastName.value = e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading.value}>
              {loading.value ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
