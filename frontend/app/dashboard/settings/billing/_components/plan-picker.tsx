"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { BillingPlan, BillingSummary } from "@/lib/billing-types";
import {
  billableSeats,
  estimateAmountCents,
  formatMoney,
  PLAN_LABELS,
} from "@/lib/billing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSubscribed } from "./status-card";

const PLANS: BillingPlan[] = ["per_user", "flat"];

function PlanOption({
  plan,
  summary: s,
  selected,
  current,
  onSelect,
}: {
  plan: BillingPlan;
  summary: BillingSummary;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const seats = billableSeats(s.billableUsers);
  const total = estimateAmountCents(plan, s.billableUsers, s.prices);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">{PLAN_LABELS[plan]}</span>
        {current && <Badge variant="secondary">Current</Badge>}
        {selected && <Check className="ml-auto size-4 text-primary" />}
      </div>
      <p className="text-2xl font-bold tabular-nums">
        {formatMoney(total, s.currency)}
        <span className="text-sm font-normal text-muted-foreground"> / month</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {plan === "per_user"
          ? `${formatMoney(s.prices.perUserCents, s.currency)} × ${seats} user${seats === 1 ? "" : "s"}. Grows and shrinks with your school.`
          : `Unlimited users for ${formatMoney(s.prices.flatCents, s.currency)} a month.`}
      </p>
    </button>
  );
}

export function PlanPicker({
  summary: s,
  busy,
  onCheckout,
  onChangePlan,
}: {
  summary: BillingSummary;
  busy: string | null;
  onCheckout: (plan: BillingPlan) => Promise<void>;
  onChangePlan: (plan: BillingPlan) => Promise<void>;
}) {
  const subscribed = isSubscribed(s);
  // Default to whichever is cheaper for the school right now.
  const cheaper: BillingPlan =
    estimateAmountCents("flat", s.billableUsers, s.prices) <
    estimateAmountCents("per_user", s.billableUsers, s.prices)
      ? "flat"
      : "per_user";
  const [selected, setSelected] = useState<BillingPlan>(s.plan ?? cheaper);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{subscribed ? "Plan" : "Choose a plan"}</CardTitle>
        <CardDescription>
          Every plan includes every feature. Billable users are active students
          and staff, counted when each invoice is issued.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {PLANS.map((plan) => (
            <PlanOption
              key={plan}
              plan={plan}
              summary={s}
              selected={selected === plan}
              current={subscribed && s.plan === plan}
              onSelect={() => setSelected(plan)}
            />
          ))}
        </div>

        {subscribed ? (
          selected !== s.plan && (
            <Button
              onClick={() => onChangePlan(selected)}
              disabled={busy !== null}
            >
              {busy === "change-plan" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Switch to the {PLAN_LABELS[selected]} plan
            </Button>
          )
        ) : !s.paymentsConfigured || s.providers.length === 0 ? (
          <div
            role="status"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <p className="font-medium">Payments are not configured yet</p>
            <p className="text-muted-foreground">
              Online payment isn&rsquo;t available on this platform right now.
              Please contact support to subscribe.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={() => onCheckout(selected)}
              disabled={busy !== null}
            >
              {busy === "checkout" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Continue to payment
            </Button>
            <p className="text-xs text-muted-foreground">
              You&rsquo;ll enter your card on {s.providers[0].label}&rsquo;s
              secure checkout page. The {PLAN_LABELS[selected]} plan renews
              monthly until you cancel.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
