"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { clearAccessToken } from "@/lib/auth";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";

interface Profile {
  school_id: string | null;
  school: { id: string; name: string } | null;
}

export default function PendingPage() {
  useSignals();
  const router = useRouter();
  const schoolName = useSignal<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get("school");
    if (name) schoolName.value = decodeURIComponent(name);

    // Poll every 10s to check if request was approved
    const interval = setInterval(async () => {
      try {
        const profile = await api<Profile>("/auth/me");
        if (profile.school_id) {
          clearInterval(interval);
          toast.success("Your request has been approved! Welcome aboard.");
          router.push("/dashboard");
        }
      } catch {
        // ignore
      }
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearAccessToken();
    router.push("/login");
  }

  return (
    <AuthPageShell>
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
            <Clock className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">Request Pending</CardTitle>
          <CardDescription>
            Your request to join{" "}
            {schoolName.value ? (
              <strong>{schoolName.value}</strong>
            ) : (
              "the school"
            )}{" "}
            is awaiting approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An admin at the school will review your request. You will
            automatically be redirected once your request is approved.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 size-4" />
            Log out
          </Button>
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
