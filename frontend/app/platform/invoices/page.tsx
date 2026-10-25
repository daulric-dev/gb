"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/billing";
import type { PlatformInvoice } from "@/lib/billing-types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { PlatformHeader } from "../_components/platform-header";
import { PlatformInvoicesTable } from "../_components/invoices-table";
import { useInitialStatusParam } from "../_components/status-filter";

const STATUSES = ["open", "paid", "void", "uncollectible"] as const;

export default function PlatformInvoicesPage() {
  const [status, setStatus] = useInitialStatusParam();
  const [rows, setRows] = useState<PlatformInvoice[] | null>(null);

  const load = useCallback(() => {
    api<PlatformInvoice[]>(
      `/platform/invoices${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    )
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => {
        setRows([]);
        toast.error(errorMessage(err, "Failed to load invoices"));
      });
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PlatformHeader
        title="Invoices"
        description="Invoices paid through Stripe, across every school"
      />
      <NativeSelect
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label="Filter by status"
        className="w-full sm:w-48"
      >
        <NativeSelectOption value="">All statuses</NativeSelectOption>
        {STATUSES.map((s) => (
          <NativeSelectOption key={s} value={s} className="capitalize">
            {s[0].toUpperCase() + s.slice(1)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Card>
        <CardContent className="p-0 sm:p-2">
          {rows === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <PlatformInvoicesTable invoices={rows} showSchool />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
