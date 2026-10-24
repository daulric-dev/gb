"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CalendarPlus, Gift, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  errorMessage,
  formatBillingDate,
  planLabel,
  statusLabel,
  statusVariant,
} from "@/lib/billing";
import type { PlatformSchoolDetail } from "@/lib/billing-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformInvoicesTable } from "../../_components/invoices-table";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
  );
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function PlatformSchoolPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const [school, setSchool] = useState<PlatformSchoolDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const [extendOpen, setExtendOpen] = useState(false);
  const [days, setDays] = useState("14");
  const [compOpen, setCompOpen] = useState(false);
  const [until, setUntil] = useState(() =>
    isoDate(new Date(Date.now() + 30 * 86_400_000)),
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<PlatformSchoolDetail>(`/platform/schools/${schoolId}`)
      .then(setSchool)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else toast.error(errorMessage(err, "Failed to load school"));
      });
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  async function extendTrial(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      toast.error("Days must be a whole number from 1 to 365");
      return;
    }
    setSaving(true);
    try {
      await api(`/platform/schools/${schoolId}/extend-trial`, {
        method: "POST",
        body: { days: n },
      });
      toast.success(`Trial extended by ${n} day${n === 1 ? "" : "s"}`);
      setExtendOpen(false);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to extend the trial"));
    } finally {
      setSaving(false);
    }
  }

  async function comp(e: React.FormEvent) {
    e.preventDefault();
    const date = new Date(`${until}T23:59:59`);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      toast.error("Pick a date in the future");
      return;
    }
    setSaving(true);
    try {
      await api(`/platform/schools/${schoolId}/comp`, {
        method: "POST",
        body: { until: date.toISOString(), note: note.trim() },
      });
      toast.success(`Complimentary access until ${formatBillingDate(date.toISOString())}`);
      setCompOpen(false);
      setNote("");
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to grant complimentary access"));
    } finally {
      setSaving(false);
    }
  }

  const back = (
    <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/platform/schools" />}>
      <ArrowLeft className="mr-1.5 size-4" />
      Schools
    </Button>
  );

  if (missing) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-muted-foreground">School not found.</p>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  const shownStatus = school.readOnly ? "read_only" : school.status;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {back}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold sm:text-3xl">{school.name}</h1>
          <Badge variant={statusVariant(shownStatus)}>{statusLabel(shownStatus)}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>School ID {school.schoolId}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Plan">{school.plan ? planLabel(school.plan) : "—"}</Field>
            <Field label="Provider">
              <span className="capitalize">{school.provider ?? "—"}</span>
            </Field>
            <Field label="Billable users">{school.billableUsers}</Field>
            <Field label="Trial ends">{formatBillingDate(school.trialEndsAt)}</Field>
            <Field label="Period ends">{formatBillingDate(school.currentPeriodEnd)}</Field>
            <Field label="Open invoices">{school.openInvoices}</Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setExtendOpen(true)}>
              <CalendarPlus className="mr-2 size-4" />
              Extend trial
            </Button>
            <Button variant="outline" onClick={() => setCompOpen(true)}>
              <Gift className="mr-2 size-4" />
              Comp until…
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformInvoicesTable invoices={school.invoices ?? []} onChanged={load} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>Payment provider notifications for this school</CardDescription>
        </CardHeader>
        <CardContent>
          {(school.events ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No events.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {school.events.map((ev, i) => (
                  <TableRow key={`${ev.createdAt}-${i}`}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="capitalize">{ev.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{ev.type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={extendOpen} onOpenChange={(o) => !saving && setExtendOpen(o)}>
        <DialogContent>
          <form onSubmit={extendTrial} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Extend trial</DialogTitle>
              <DialogDescription>
                Adds days to {school.name}&apos;s free trial. The school can
                make changes for as long as the trial runs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="extend-days">Days</Label>
              <Input
                id="extend-days"
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExtendOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Extend
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={compOpen} onOpenChange={(o) => !saving && setCompOpen(o)}>
        <DialogContent>
          <form onSubmit={comp} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Complimentary access</DialogTitle>
              <DialogDescription>
                Marks {school.name} active without payment until the date you
                choose. After it, the school needs a paid plan.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="comp-until">Until</Label>
              <Input
                id="comp-until"
                type="date"
                value={until}
                min={isoDate(new Date())}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="comp-note">Note</Label>
              <Textarea
                id="comp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why - e.g. pilot partner, nonprofit discount"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCompOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Grant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
