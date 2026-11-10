"use client";

import type { ReactNode } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import { pct, RULE_LABEL, type AtRiskStudent } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Download one analytics table as CSV (the API names the file). */
export function CsvButton({ path, fallbackName, label = "CSV" }: { path: string; fallbackName: string; label?: string }) {
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
    <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy.value} aria-label={`Export ${label} as CSV`}>
      {busy.value ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : <Download className="mr-1.5 size-4" aria-hidden />}
      CSV
    </Button>
  );
}

/** A labelled number tile; the value is text, never only a colour. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A chart card with a written summary (always shown, and the chart's
 * accessible description) and a Chart / Table switch, so the same data is
 * available as a table. Charts are single-series: nothing depends on colour.
 */
export function ChartCard({
  title,
  description,
  summary,
  chart,
  table,
  actions,
  empty,
  level = 3,
}: {
  title: string;
  /** Heading level of the title (2 on a page whose sections are cards). */
  level?: 2 | 3;
  description?: ReactNode;
  summary: string;
  chart: ReactNode;
  table: ReactNode;
  actions?: ReactNode;
  /** Shown instead of the chart and table when there is no data. */
  empty?: string | null;
}) {
  useSignals();
  const view = useSignal<"chart" | "table">("chart");
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>
            <Heading>{title}</Heading>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!empty && (
            <Tabs value={view.value} onValueChange={(v) => (view.value = v as "chart" | "table")}>
              <TabsList aria-label={`${title}: show as`}>
                <TabsTrigger value="chart">Chart</TabsTrigger>
                <TabsTrigger value="table">Table</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {actions}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        {empty ? null : view.value === "chart" ? (
          <figure aria-label={`${title}. ${summary}`} role="img">
            {chart}
          </figure>
        ) : (
          <div className="overflow-x-auto">{table}</div>
        )}
      </CardContent>
    </Card>
  );
}

const SINGLE: ChartConfig = { value: { label: "Value", color: "var(--color-chart-2)" } };

/** Vertical bars with the value printed on each bar. */
export function ValueBarChart({
  data,
  label,
  unit = "",
  max,
}: {
  data: { name: string; value: number | null }[];
  label: string;
  unit?: string;
  max?: number;
}) {
  const config: ChartConfig = { value: { ...SINGLE.value, label } };
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden>
      <BarChart data={data} margin={{ top: 20, left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
        <YAxis width={36} domain={[0, max ?? "auto"]} allowDecimals={false} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={4}>
          <LabelList
            dataKey="value"
            position="top"
            className="fill-foreground"
            fontSize={11}
            formatter={(v: unknown) => (v === null || v === undefined ? "" : `${String(v)}${unit}`)}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Weekly average line with a dot and value per week. */
export function TrendLineChart({ data }: { data: { week: string; average: number }[] }) {
  const config: ChartConfig = { average: { label: "Average %", color: "var(--color-chart-1)" } };
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden>
      <LineChart data={data} margin={{ top: 20, left: 4, right: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis width={36} domain={[0, 100]} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line dataKey="average" stroke="var(--color-average)" strokeWidth={2} dot={{ r: 4 }}>
          <LabelList dataKey="average" position="top" className="fill-foreground" fontSize={11} />
        </Line>
      </LineChart>
    </ChartContainer>
  );
}

/** Reasons as labelled badges plus their full text. */
export function RiskReasons({ reasons }: { reasons: AtRiskStudent["reasons"] }) {
  return (
    <ul className="space-y-1">
      {reasons.map((r) => (
        <li key={r.rule} className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">{RULE_LABEL[r.rule]}</Badge>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Ann Lee" for a row with first/last names. */
export function studentName(s: { firstName: string | null; lastName: string | null }): string {
  return personName(s);
}

export { pct };
