"use client";

import Link from "next/link";
import { ChevronRight, CreditCard } from "lucide-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BILLING_PATH, billingStatus, statusLabel } from "@/lib/billing";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Card } from "@/components/ui/card";

/**
 * Settings entry for the school billing page: administrators only, and only
 * on the hosted platform (billing on).
 */
export function BillingSettingsLink() {
  useSignals();
  const { can } = usePermissions();
  const status = billingStatus.value;
  if (!status.enabled || !can("school", "update")) return null;

  return (
    <Card className="p-0">
      <Link
        href={BILLING_PATH}
        className="flex items-center gap-4 rounded-xl p-6 transition-colors hover:bg-accent/50"
      >
        <CreditCard className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">Billing</h2>
          <p className="text-sm text-muted-foreground">
            Plan, payment method and invoices
            {status.status ? ` · ${statusLabel(status.readOnly ? "read_only" : status.status)}` : ""}
          </p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    </Card>
  );
}
