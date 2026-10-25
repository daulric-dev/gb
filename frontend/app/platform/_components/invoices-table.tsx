"use client";

import Link from "next/link";
import type { Invoice, PlatformInvoice } from "@/lib/billing-types";
import {
  formatBillingDate,
  formatMoney,
  invoiceStatusVariant,
} from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = Invoice & Partial<Pick<PlatformInvoice, "schoolId" | "schoolName">>;

/**
 * Invoices recorded from Stripe webhooks (read-only: Stripe owns invoices,
 * so refunds and voids happen in the Stripe Dashboard).
 */
export function PlatformInvoicesTable({
  invoices,
  showSchool,
}: {
  invoices: Row[];
  showSchool?: boolean;
}) {
  if (invoices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No invoices.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Number</TableHead>
          {showSchool && <TableHead>School</TableHead>}
          <TableHead>Period</TableHead>
          <TableHead className="text-right">Seats</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Due / paid</TableHead>
          <TableHead>Provider</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium whitespace-nowrap">{inv.number}</TableCell>
            {showSchool && (
              <TableCell className="max-w-48 truncate">
                {inv.schoolId ? (
                  <Link
                    href={`/platform/schools/${inv.schoolId}`}
                    className="hover:underline"
                  >
                    {inv.schoolName ?? inv.schoolId}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
            )}
            <TableCell className="whitespace-nowrap">
              {formatBillingDate(inv.periodStart)} – {formatBillingDate(inv.periodEnd)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {inv.plan === "flat" ? "Unlimited" : inv.seats}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(inv.amountCents, inv.currency)}
            </TableCell>
            <TableCell>
              <Badge variant={invoiceStatusVariant(inv.status)} className="capitalize">
                {inv.status}
              </Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {inv.status === "paid"
                ? `Paid ${formatBillingDate(inv.paidAt)}${inv.method ? ` · ${inv.method.replace(/_/g, " ")}` : ""}`
                : inv.dueAt
                  ? `Due ${formatBillingDate(inv.dueAt)}`
                  : "—"}
            </TableCell>
            <TableCell className="capitalize">{inv.provider ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
