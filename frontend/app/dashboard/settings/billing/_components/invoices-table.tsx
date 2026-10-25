"use client";

import type { Invoice } from "@/lib/billing-types";
import {
  formatBillingDate,
  formatMoney,
  invoiceStatusVariant,
} from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Payments Stripe reported for this school. Receipts and PDFs live in the Stripe portal. */
export function InvoicesTable({ invoices }: { invoices: Invoice[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          Monthly payments for your subscription. To download receipts and
          invoice PDFs, use &ldquo;Manage payment method &amp; invoices&rdquo;
          above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No invoices yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Seats</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due / paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.number}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatBillingDate(inv.periodStart)} –{" "}
                    {formatBillingDate(inv.periodEnd)}
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
                      ? `Paid ${formatBillingDate(inv.paidAt)}`
                      : inv.dueAt
                        ? `Due ${formatBillingDate(inv.dueAt)}`
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
