"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import {
  errorMessage,
  formatBillingDate,
  planLabel,
  statusLabel,
  statusVariant,
} from "@/lib/billing";
import type { PlatformSchoolRow } from "@/lib/billing-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformHeader } from "../_components/platform-header";
import { useInitialStatusParam } from "../_components/status-filter";

const SCHOOL_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "read_only",
] as const;

export default function PlatformSchoolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useInitialStatusParam();
  const [rows, setRows] = useState<PlatformSchoolRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const qs = params.toString();
      api<PlatformSchoolRow[]>(`/platform/schools${qs ? `?${qs}` : ""}`)
        .then((data) => {
          if (!cancelled) setRows(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          if (!cancelled) {
            setRows([]);
            toast.error(errorMessage(err, "Failed to load schools"));
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, status]);

  return (
    <div className="space-y-6">
      <PlatformHeader
        title="Schools"
        description="Every school's subscription, trial and invoices"
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search schools"
            className="pl-8"
            aria-label="Search schools"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="w-full sm:w-48"
        >
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {SCHOOL_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {statusLabel(s)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <Card>
        <CardContent className="p-0 sm:p-2">
          {rows === null ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No schools match.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead>Trial ends / renews</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Open invoices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.schoolId}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => router.push(`/platform/schools/${r.schoolId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(`/platform/schools/${r.schoolId}`);
                    }}
                  >
                    <TableCell className="max-w-56 truncate font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.readOnly ? "read_only" : r.status)}>
                        {statusLabel(r.readOnly ? "read_only" : r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.plan ? planLabel(r.plan) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.billableUsers}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatBillingDate(
                        r.status === "trialing" ? r.trialEndsAt : r.currentPeriodEnd,
                      )}
                    </TableCell>
                    <TableCell className="capitalize">{r.provider ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.openInvoices}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
