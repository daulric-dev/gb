"use client";

import { useState } from "react";
import { CalendarClock, CreditCard, Loader2, Users } from "lucide-react";
import type { BillingSummary } from "@/lib/billing-types";
import {
  daysUntil,
  formatBillingDate,
  formatMoney,
  planLabel,
  statusLabel,
  statusVariant,
} from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Whether the school's stored provider is one this deployment offers (Stripe). */
export function hasKnownProvider(s: BillingSummary): boolean {
  return !!s.provider && s.providers.some((p) => p.id === s.provider);
}

/**
 * Whether the school has a live paid subscription (vs. trial / lapsed). A
 * provider id this deployment no longer offers (a legacy one) does not count:
 * the school subscribes again with Stripe.
 */
export function isSubscribed(s: BillingSummary): boolean {
  return (
    hasKnownProvider(s) &&
    !!s.plan &&
    !s.readOnly &&
    (s.status === "active" || s.status === "past_due")
  );
}

/** Whether "Manage payment method & invoices" (the Stripe Customer Portal) applies. */
export function canOpenPortal(s: BillingSummary): boolean {
  return hasKnownProvider(s) && !!s.plan && s.status !== "canceled";
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function StatusCard({
  summary: s,
  busy,
  showPortal,
  onCancel,
  onResume,
  onPortal,
}: {
  summary: BillingSummary;
  busy: string | null;
  showPortal: boolean;
  onCancel: () => Promise<void>;
  onResume: () => Promise<void>;
  onPortal: () => Promise<void>;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const subscribed = isSubscribed(s);
  const trialDays = daysUntil(s.trialEndsAt);
  const providerLabel = s.providers.find((p) => p.id === s.provider)?.label;

  let dateLabel = "Renews";
  let dateValue = formatBillingDate(s.currentPeriodEnd);
  if (s.status === "trialing") {
    dateLabel = "Trial ends";
    dateValue = formatBillingDate(s.trialEndsAt);
  } else if (s.cancelAtPeriodEnd) {
    dateLabel = "Ends";
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Subscription</CardTitle>
          <Badge variant={statusVariant(s.readOnly ? "read_only" : s.status)}>
            {statusLabel(s.readOnly ? "read_only" : s.status)}
          </Badge>
        </div>
        <CardDescription>
          {s.plan ? `${planLabel(s.plan)} plan` : "No plan chosen yet"}
          {providerLabel ? ` · paid with ${providerLabel}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {s.readOnly && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            The platform is read-only for your school. Choose a plan below and
            subscribe to make changes again.
          </p>
        )}
        {s.status === "trialing" && !s.readOnly && trialDays !== null && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm">
            {trialDays === 0
              ? "Your free trial ends today."
              : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your free trial.`}{" "}
            After it ends the platform becomes read-only until you choose a plan.
          </p>
        )}
        {s.cancelAtPeriodEnd && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Your subscription is set to cancel on{" "}
            <strong>{formatBillingDate(s.currentPeriodEnd)}</strong>. After that
            the platform becomes read-only. Resume to keep it running.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            icon={Users}
            label="Billable users"
            value={String(s.billableUsers)}
            hint="Active students and staff"
          />
          <Stat
            icon={CreditCard}
            label="Estimated monthly"
            value={formatMoney(s.estimatedAmountCents, s.currency)}
            hint={s.plan ? planLabel(s.plan) : "On the per-user plan"}
          />
          <Stat icon={CalendarClock} label={dateLabel} value={dateValue} />
        </div>

        {(subscribed || showPortal) && (
          <div className="flex flex-wrap gap-2">
            {showPortal && (
              <Button
                variant="outline"
                onClick={onPortal}
                disabled={busy !== null}
              >
                {busy === "portal" && <Loader2 className="mr-2 size-4 animate-spin" />}
                Manage payment method &amp; invoices
              </Button>
            )}
            {subscribed &&
              (s.cancelAtPeriodEnd ? (
                <Button onClick={onResume} disabled={busy !== null}>
                  {busy === "resume" && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Resume subscription
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirmCancel(true)}
                  disabled={busy !== null}
                >
                  Cancel subscription
                </Button>
              ))}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={confirmCancel}
        onOpenChange={(o) => {
          if (!o && busy !== "cancel") setConfirmCancel(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays active until {formatBillingDate(s.currentPeriodEnd)}.
              After that the platform becomes read-only for everyone in your
              school until you subscribe again. You can resume any time before
              then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "cancel"}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "cancel"}
              onClick={async () => {
                await onCancel();
                setConfirmCancel(false);
              }}
            >
              {busy === "cancel" && <Loader2 className="mr-2 size-4 animate-spin" />}
              Cancel at period end
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
