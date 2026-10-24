"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, MoreHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import type {
  Invoice,
  MarkPaidMethod,
  PlatformInvoice,
} from "@/lib/billing-types";
import {
  errorMessage,
  formatBillingDate,
  formatMoney,
  invoiceStatusVariant,
  MARK_PAID_METHODS,
} from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Row = Invoice & Partial<Pick<PlatformInvoice, "schoolId" | "schoolName">>;

function MarkPaidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<MarkPaidMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setSaving(true);
    try {
      await api(`/platform/invoices/${invoice.id}/mark-paid`, {
        method: "POST",
        body: {
          method,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
      toast.success(`${invoice.number} marked paid`);
      setReference("");
      setNote("");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to mark the invoice paid"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mark {invoice?.number} paid</DialogTitle>
            <DialogDescription>
              Records a payment received outside the platform. The school&apos;s
              subscription is extended by one period.
              {invoice &&
                ` Amount: ${formatMoney(invoice.amountCents, invoice.currency)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mp-method">Method</Label>
            <NativeSelect
              id="mp-method"
              className="w-full"
              value={method}
              onChange={(e) => setMethod(e.target.value as MarkPaidMethod)}
            >
              {MARK_PAID_METHODS.map((m) => (
                <NativeSelectOption key={m.value} value={m.value}>
                  {m.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-ref">Reference (optional)</Label>
            <Input
              id="mp-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank reference, cheque number…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mp-note">Note (optional)</Label>
            <Textarea
              id="mp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Mark paid
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!invoice) return;
    setSaving(true);
    try {
      await api(`/platform/invoices/${invoice.id}/void`, {
        method: "POST",
        body: { note: note.trim() || undefined },
      });
      toast.success(`${invoice.number} voided`);
      setNote("");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to void the invoice"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {invoice?.number}?</DialogTitle>
          <DialogDescription>
            The invoice is cancelled and can no longer be paid. This cannot be
            undone; the next sweep does not re-issue it for the same month.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-note">Note (optional)</Label>
          <Textarea
            id="void-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Invoices with operator actions (mark paid, void) on open ones. */
export function PlatformInvoicesTable({
  invoices,
  showSchool,
  onChanged,
}: {
  invoices: Row[];
  showSchool?: boolean;
  onChanged: () => void;
}) {
  const [paying, setPaying] = useState<Row | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);

  if (invoices.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No invoices.
      </p>
    );
  }

  return (
    <>
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
            <TableHead className="w-0" />
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
              <TableCell className="text-right">
                {inv.status === "open" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" aria-label="Invoice actions" />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setPaying(inv)}>
                        Mark paid
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setVoiding(inv)}
                      >
                        Void
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <MarkPaidDialog
        invoice={paying}
        onClose={() => setPaying(null)}
        onDone={() => {
          setPaying(null);
          onChanged();
        }}
      />
      <VoidDialog
        invoice={voiding}
        onClose={() => setVoiding(null)}
        onDone={() => {
          setVoiding(null);
          onChanged();
        }}
      />
    </>
  );
}
