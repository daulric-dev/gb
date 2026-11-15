"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RetentionView = {
  leaverRetentionDays: number | null;
  closedYearRetentionYears: number | null;
  confirmedAt: string | null;
  active: boolean;
  due: { id: string; firstName: string | null; lastName: string | null; rule: "leaver" | "closed_year"; dueAt: string }[];
  noticeDays: number;
};

const PATH = "/schools/current/retention";

/** School-admin controls for the existing preview, confirm, and purge flow. */
export function SchoolRecordRetentionSettings() {
  useSignals();
  const can = useOptionalCan();
  const allowed = can("student", "erase");
  const view = useSignal<RetentionView | null>(null);
  const leaverDays = useSignal("");
  const closedYears = useSignal("");
  const loading = useSignal(true);
  const saving = useSignal(false);

  useEffect(() => {
    if (!allowed) {
      loading.value = false;
      return;
    }
    api<RetentionView>(PATH)
      .then((result) => {
        view.value = result;
        leaverDays.value = result.leaverRetentionDays?.toString() ?? "";
        closedYears.value = result.closedYearRetentionYears?.toString() ?? "";
      })
      .catch((err) => toast.error(userMessage(err, "Failed to load student-record retention")))
      .finally(() => (loading.value = false));
  }, [allowed, view, leaverDays, closedYears, loading]);

  const current = view.value;
  if (!allowed || loading.value || !current) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const days = leaverDays.value.trim() ? Number(leaverDays.value) : null;
    const years = closedYears.value.trim() ? Number(closedYears.value) : null;
    if (days !== null && (!Number.isInteger(days) || days < 30 || days > 3650)) {
      toast.error("Leaver retention must be 30–3650 whole days, or blank");
      return;
    }
    if (years !== null && (!Number.isInteger(years) || years < 1 || years > 25)) {
      toast.error("Closed-year retention must be 1–25 whole years, or blank");
      return;
    }

    saving.value = true;
    try {
      const result = await api<RetentionView>(PATH, {
        method: "PUT",
        body: { leaverRetentionDays: days, closedYearRetentionYears: years },
        stepUp: true,
      });
      view.value = result;
      leaverDays.value = result.leaverRetentionDays?.toString() ?? "";
      closedYears.value = result.closedYearRetentionYears?.toString() ?? "";
      toast.success("Retention schedule saved. Review and confirm it before erasure runs.");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the retention schedule"));
    } finally {
      saving.value = false;
    }
  }

  const draftChanged =
    leaverDays.value !== (current.leaverRetentionDays?.toString() ?? "") ||
    closedYears.value !== (current.closedYearRetentionYears?.toString() ?? "");

  async function confirmSchedule() {
    const count = view.value?.due.length ?? 0;
    const dueText = count === 0
      ? "No student records are due within the next 30 days."
      : `${count} student record${count === 1 ? " is" : "s are"} due within the next 30 days.`;
    if (!window.confirm(`${dueText}\n\nConfirming enables the daily job to erase records matching this schedule once they are due. This cannot be undone. Continue?`)) return;

    saving.value = true;
    try {
      view.value = await api<RetentionView>(`${PATH}/confirm`, {
        method: "POST",
        stepUp: true,
      });
      toast.success("Retention schedule confirmed");
    } catch (err) {
      toast.error(userMessage(err, "Failed to confirm the retention schedule"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">Student-record retention</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set when inactive students or records from closed academic years are erased. Choose periods that match the school&apos;s approved retention schedule; GradeBook does not choose a legal period for you.
        </p>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="leaver-retention-days">Days after a student leaves</Label>
            <Input id="leaver-retention-days" type="number" min={30} max={3650} step={1} inputMode="numeric" value={leaverDays.value} onChange={(e) => (leaverDays.value = e.target.value)} placeholder="Off" />
            <p className="text-xs text-muted-foreground">30–3650 days. Blank disables this rule.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="closed-year-retention-years">Years after the last academic year ends</Label>
            <Input id="closed-year-retention-years" type="number" min={1} max={25} step={1} inputMode="numeric" value={closedYears.value} onChange={(e) => (closedYears.value = e.target.value)} placeholder="Off" />
            <p className="text-xs text-muted-foreground">1–25 years. Blank disables this rule.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={saving.value}>
            {saving.value && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save schedule
          </Button>
          <span className="text-xs text-muted-foreground">Changing a schedule clears its confirmation. Saving and confirming require identity verification.</span>
        </div>
      </form>

      <div className="rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Review due records</h3>
            <p className="text-sm text-muted-foreground">
              {current.due.length} due within {current.noticeDays} days. {current.active ? "The schedule is confirmed." : "The schedule is not confirmed; no student records will be erased by it."}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={saving.value || draftChanged || (!current.leaverRetentionDays && !current.closedYearRetentionYears)} onClick={() => void confirmSchedule()}>
            {current.active ? "Review and confirm again" : "Confirm schedule"}
          </Button>
        </div>
        {current.due.length > 0 && (
          <ul className="mt-3 divide-y text-sm">
            {current.due.map((student) => (
              <li key={`${student.id}:${student.rule}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{[student.firstName, student.lastName].filter(Boolean).join(" ") || "Unnamed student"}</span>
                <span className="text-muted-foreground">
                  {student.rule === "leaver" ? "Leaver" : "Closed academic year"} · due {student.dueAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
