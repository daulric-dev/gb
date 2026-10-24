"use client";

import { useCallback, useEffect } from "react";
import { notFound, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import {
  billingLoaded,
  billingStatus,
  errorMessage,
  refreshBillingStatus,
} from "@/lib/billing";
import type {
  BillingPlan,
  BillingSummary,
  Invoice,
  PayResult,
} from "@/lib/billing-types";
import { usePermissions } from "@/providers/PermissionsProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { PermissionDenied } from "@/components/dashboard/permission-denied";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  InstructionsDialog,
  safeRedirect,
} from "@/components/billing/instructions-dialog";
import { StatusCard } from "./_components/status-card";
import { PlanPicker } from "./_components/plan-picker";
import { InvoicesTable } from "./_components/invoices-table";

const TITLE = "Billing";
const DESCRIPTION = "Your school's plan, payments and invoices";

export default function BillingPage() {
  useSignals();
  const router = useRouter();
  const { can } = usePermissions();
  const allowed = can("school", "update");

  const summary = useSignal<BillingSummary | null>(null);
  const invoices = useSignal<Invoice[]>([]);
  const loading = useSignal(true);
  const missing = useSignal(false);
  const busy = useSignal<string | null>(null);
  const instructions = useSignal<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, inv] = await Promise.all([
        api<BillingSummary>("/billing"),
        api<Invoice[]>("/billing/invoices").catch(() => [] as Invoice[]),
      ]);
      if (!s.enabled) {
        missing.value = true;
        return;
      }
      summary.value = s;
      invoices.value = Array.isArray(inv) ? inv : [];
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) missing.value = true;
      else toast.error(errorMessage(err, "Failed to load billing"));
    } finally {
      loading.value = false;
    }
  }, [summary, invoices, loading, missing]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  // Back from a provider's hosted checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (!checkout) return;
    if (checkout === "success") {
      toast.success("Payment received - thank you. It can take a minute to show here.");
    } else if (checkout === "cancel") {
      toast("Checkout canceled - nothing was charged.");
    }
    void refreshBillingStatus();
    router.replace(window.location.pathname);
  }, [router]);

  async function afterChange(next?: BillingSummary) {
    if (next && typeof next === "object" && "status" in next) {
      summary.value = next;
    }
    await Promise.all([load(), refreshBillingStatus()]);
  }

  function handlePayResult(result: PayResult) {
    if (result?.redirectUrl) {
      if (safeRedirect(result.redirectUrl)) return;
      toast.error("The payment provider returned an invalid link");
      return;
    }
    if (result?.instructions) instructions.value = result.instructions;
    else toast.success("Done");
  }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    busy.value = key;
    try {
      return await fn();
    } catch (err) {
      // 402s already raised the app-wide notice.
      if (!(err instanceof ApiError && err.status === 402)) {
        toast.error(errorMessage(err, "Something went wrong"));
      }
      return null;
    } finally {
      busy.value = null;
    }
  }

  async function checkout(plan: BillingPlan, provider: string) {
    const result = await run(`checkout:${provider}`, () =>
      api<PayResult>("/billing/checkout", {
        method: "POST",
        body: { plan, provider },
      }),
    );
    if (!result) return;
    handlePayResult(result);
    if (!result.redirectUrl) await afterChange();
  }

  async function changePlan(plan: BillingPlan) {
    const next = await run("change-plan", () =>
      api<BillingSummary>("/billing/change-plan", {
        method: "POST",
        body: { plan },
      }),
    );
    if (!next) return;
    toast.success("Plan changed");
    await afterChange(next);
  }

  async function cancel() {
    const next = await run("cancel", () =>
      api<BillingSummary>("/billing/cancel", { method: "POST" }),
    );
    if (!next) return;
    toast.success("Your subscription will end at the close of this period");
    await afterChange(next);
  }

  async function resume() {
    const next = await run("resume", () =>
      api<BillingSummary>("/billing/resume", { method: "POST" }),
    );
    if (!next) return;
    toast.success("Subscription resumed");
    await afterChange(next);
  }

  const portalUnavailable = useSignal(false);
  async function openPortal() {
    const res = await run("portal", () =>
      api<{ url: string | null }>("/billing/portal", { method: "POST" }),
    );
    if (!res) return;
    if (res.url && safeRedirect(res.url)) return;
    portalUnavailable.value = true;
    toast("Your payment provider has no self-service page for this subscription.");
  }

  async function payInvoice(invoice: Invoice, provider: string) {
    const result = await run(`pay:${invoice.id}`, () =>
      api<PayResult>(`/billing/invoices/${invoice.id}/pay`, {
        method: "POST",
        body: { provider },
      }),
    );
    if (!result) return;
    handlePayResult(result);
  }

  // Self-hosted (billing off) has no billing page at all.
  if ((billingLoaded.value && !billingStatus.value.enabled) || missing.value) {
    notFound();
  }

  if (!allowed) {
    return (
      <PermissionDenied
        title={TITLE}
        description={DESCRIPTION}
        message="Only school administrators can manage billing."
      />
    );
  }

  const s = summary.value;
  if (loading.value || !s) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader title={TITLE} description={DESCRIPTION} />
        <Card className="space-y-3 p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-52" />
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  const currentMode = s.providers.find((p) => p.id === s.provider)?.mode;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={TITLE} description={DESCRIPTION} />

      <StatusCard
        summary={s}
        busy={busy.value}
        showPortal={currentMode === "subscription" && !portalUnavailable.value}
        onCancel={cancel}
        onResume={resume}
        onPortal={openPortal}
      />

      <PlanPicker
        summary={s}
        busy={busy.value}
        onCheckout={checkout}
        onChangePlan={changePlan}
      />

      <InvoicesTable
        invoices={invoices.value}
        providers={s.providers.filter((p) => p.mode === "invoice")}
        busy={busy.value}
        onPay={payInvoice}
      />

      <InstructionsDialog
        instructions={instructions.value}
        onClose={() => (instructions.value = null)}
      />
    </div>
  );
}
