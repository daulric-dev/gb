"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { KeyRound } from "lucide-react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { homePathFor, NEXT_PARAM, safeNextPath } from "@/lib/routing";
import { useAuth } from "@/providers/AuthProvider";
import { getMfaStatus } from "@/components/account/mfa/mfa-api";
import { MfaEnrolmentFlow } from "@/components/account/mfa/mfa-enrolment-flow";

/**
 * Where a session limited by the organisation's requirement (403
 * MFA_ENROLMENT_REQUIRED) sets up its authenticator app before anything else.
 */
function SetupForm() {
  useSignals();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, refresh } = useAuth();
  const next = safeNextPath(searchParams?.get(NEXT_PARAM));

  // Nothing to do here once set up (or when not required). Checked on arrival.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    getMfaStatus()
      .then((s) => {
        if (!s.enrolmentRequired) router.replace(next ?? homePathFor(profile.value));
      })
      .catch(() => {});
  }, [router, next, profile]);

  async function done() {
    await refresh();
    const home = homePathFor(profile.value);
    const setupDone = home === "/portal" || home === "/dashboard" || home === "/parent";
    router.replace(setupDone && next ? next : home);
  }

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <KeyRound className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Set up two-step verification</h1>
          <p className="text-sm text-muted-foreground">
            Your organisation requires an authenticator app for your role. Set
            one up to continue. First we will email you a code to confirm
            it&apos;s you.
          </p>
        </div>
        <MfaEnrolmentFlow
          onDone={() => void done()}
          onCancel={() => void signOut()}
          cancelLabel="Sign out"
        />
      </CardContent>
    </Card>
  );
}

export default function TwoStepSetupPage() {
  return (
    <Suspense>
      <AuthPageShell>
        <SetupForm />
      </AuthPageShell>
    </Suspense>
  );
}
