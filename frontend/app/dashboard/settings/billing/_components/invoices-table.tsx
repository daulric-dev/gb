"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import type { BillingProviderOption, Invoice } from "@/lib/billing-types";
import {
  formatBillingDate,
  formatMoney,
  invoiceStatusVariant,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PayButton({
  invoice,
  providers,
  busy,
  onPay,
}: {
  invoice: Invoice;
  providers: BillingProviderOption[];
  busy: string | null;
  onPay: (invoice: Invoice, provider: string) => Promise<void>;
}) {
  const working = busy === `pay:${invoice.id}`;
  if (providers.length === 0) return null;
  if (providers.length === 1) {
    return (
      <Button
        size="sm"
        disabled={busy !== null}
        onClick={() => onPay(invoice, providers[0].id)}
      >
        {working && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
        Pay
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" disabled={busy !== null} />}
      >
        {working && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
        Pay
        <ChevronDown className="ml-1 size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {providers.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onPay(invoice, p.id)}>
            {p.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InvoicesTable({
  invoices,
  providers,
  busy,
  onPay,
}: {
  invoices: Invoice[];
  /** Invoice-mode providers the school may pay an open invoice with. */
  providers: BillingProviderOption[];
  busy: string | null;
  onPay: (invoice: Invoice, provider: string) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          Monthly invoices for invoice-based payment methods. Card
          subscriptions are receipted by the payment provider.
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
                <TableHead className="w-0" />
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
                  <TableCell className="text-right">
                    {inv.status === "open" && (
                      <PayButton
                        invoice={inv}
                        providers={providers}
                        busy={busy}
                        onPay={onPay}
                      />
                    )}
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
