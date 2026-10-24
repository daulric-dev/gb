"use client";

import Link from "next/link";
import { useSignals } from "@preact/signals-react/runtime";
import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BILLING_PATH,
  billingLoaded,
  billingStatus,
  daysUntil,
  useBillingStatusLoader,
} from "@/lib/billing";

/**
 * Loads the billing status for an app shell (once, refreshed on focus). It
 * renders nothing; mount it once per layout.
 */
export function BillingStatusLoader({ schoolId }: { schoolId: string | null }) {
  useBillingStatusLoader(schoolId);
  return null;
}

/**
 * The app-wide trial / read-only notice. Renders nothing while billing is off
 * (self-hosted) or before the status has loaded.
 *
 * - `admin`: may manage billing - gets "Choose a plan" / "Renew" links.
 * - `staff`: told to ask an administrator.
 * - `student`: only ever sees the read-only notice.
 */
export function BillingBanner({
  audience,
}: {
  audience: "admin" | "staff" | "student";
}) {
  useSignals();
  const status = billingStatus.value;
  if (!billingLoaded.value || !status.enabled) return null;

  if (status.readOnly) {
    return (
      <div
        role="alert"
        className="mb-4 flex animate-fade-in-up flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive text-white">
          <Lock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {audience === "admin"
              ? "Your subscription has lapsed - the platform is read-only."
              : "Your school's subscription has lapsed - the platform is read-only."}
          </p>
          <p className="text-sm text-muted-foreground">
            {audience === "admin"
              ? "Everything stays viewable. Renew to make changes again."
              : "You can still view everything. Ask your school administrator to renew."}
          </p>
        </div>
        {audience === "admin" && (
          <Button size="sm" nativeButton={false} render={<Link href={BILLING_PATH} />}>
            Renew
          </Button>
        )}
      </div>
    );
  }

  if (status.status !== "trialing" || audience === "student") return null;

  const days = daysUntil(status.trialEndsAt);
  const left =
    days === null
      ? "Your free trial is active."
      : days === 0
        ? "Your free trial ends today."
        : `${days} day${days === 1 ? "" : "s"} left in your free trial.`;

  return (
    <div
      role="status"
      className="mb-4 flex animate-fade-in-up flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Clock className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{left}</p>
        <p className="text-sm text-muted-foreground">
          {audience === "admin"
            ? "Choose a plan before it ends to keep editing - after the trial the platform becomes read-only."
            : "After the trial the platform becomes read-only until your school administrator chooses a plan."}
        </p>
      </div>
      {audience === "admin" && (
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href={BILLING_PATH} />}
        >
          Choose a plan
        </Button>
      )}
    </div>
  );
}
