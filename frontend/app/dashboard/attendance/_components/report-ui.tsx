"use client";

import { Download, Loader2 } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { rateColor } from "@/lib/attendance";
import { formatPercent, type Tally } from "@/lib/attendance-reports";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** From / to date inputs (local school days, inclusive). */
export function RangePicker({
  from,
  to,
  onChangeAction,
}: {
  from: string;
  to: string;
  onChangeAction: (range: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Report dates">
      <div className="space-y-1.5">
        <Label htmlFor="range-from">From</Label>
        <Input
          id="range-from"
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && onChangeAction({ from: e.target.value, to })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="range-to">To</Label>
        <Input
          id="range-to"
          type="date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && onChangeAction({ from, to: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Download a report CSV (the API names the file). */
export function CsvButton({ path, fallbackName, disabled }: { path: string; fallbackName: string; disabled?: boolean }) {
  useSignals();
  const busy = useSignal(false);
  async function run() {
    busy.value = true;
    try {
      await downloadFromUrl(path, fallbackName);
    } catch (err) {
      toast.error(userMessage(err, "Export failed"));
    } finally {
      busy.value = false;
    }
  }
  return (
    <Button variant="outline" onClick={() => void run()} disabled={busy.value || disabled}>
      {busy.value ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" aria-hidden />}
      Export CSV
    </Button>
  );
}

/** A rate cell, coloured like the course attendance page. */
export function Rate({ t, className }: { t: Pick<Tally, "rate">; className?: string }) {
  return <span className={cn("font-semibold tabular-nums", rateColor(t.rate), className)}>{formatPercent(t.rate)}</span>;
}

/** "12 present · 1 late · 3 absent · 0 excused". */
export function TallyLine({ t }: { t: Tally }) {
  return (
    <span className="text-sm text-muted-foreground">
      {t.present} present · {t.late} late · {t.absent} absent · {t.excused} excused
    </span>
  );
}
