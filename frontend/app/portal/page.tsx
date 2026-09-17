"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder student landing page. The self-scoped portal API and its UI
 * (grades, attendance, reports) land in later phases; this exists so the
 * claim flow has somewhere to finish rather than dead-ending.
 */
export default function PortalPage() {
  useSignals();

  const router = useRouter();
  const { profile, loading } = useProfile();

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      router.replace("/login");
      return;
    }
    // Staff have no business here, and a student without a school has not
    // redeemed a claim code yet.
    if (profile.value.account_type !== "student") {
      router.replace("/dashboard");
      return;
    }
    if (!profile.value.school) {
      router.replace("/claim");
    }
  }, [loading.value, profile.value, router]);

  if (loading.value || !profile.value) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">
          Hello {profile.value.first_name ?? "there"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {profile.value.school?.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your account is linked</CardTitle>
          <CardDescription>
            This login is now connected to your student record.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Your grades, attendance and reports will appear here once the student
          portal is switched on.
        </CardContent>
      </Card>
    </div>
  );
}
