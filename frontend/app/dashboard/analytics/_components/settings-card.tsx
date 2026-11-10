"use client";

import { useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { AnalyticsSettings, AtRiskRules } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PATH = "/analytics/settings";

type Field = { key: keyof AtRiskRules; label: string; hint: string; min: number; max: number; optional: boolean };

/** The school's at-risk rules (school:update). Empty switches a rule off. */
export function AnalyticsSettingsCard({ onSavedAction }: { onSavedAction?: () => void }) {
  useSignals();
  const loaded = useSignal<AnalyticsSettings | null>(null);
  const draft = useSignal<AtRiskRules | null>(null);
  const saving = useSignal(false);
  const err = useSignal<string | null>(null);

  useEffect(() => {
    api<AnalyticsSettings>(PATH)
      .then((s) => {
        loaded.value = s;
        draft.value = s.rules;
      })
      .catch(() => (loaded.value = null));
  }, [loaded, draft]);

  if (!loaded.value || !draft.value) return null;
  const d = draft.value;
  const f = loaded.value.features;
  const fields: Field[] = [
    { key: "minGrade", label: "Current grade below (%)", hint: "", min: 1, max: 100, optional: true },
    { key: "missingCount", label: "Missing work, at least", hint: "Pieces due in the window.", min: 1, max: 50, optional: true },
    { key: "windowWeeks", label: "Window (weeks)", hint: "For missing work and attendance.", min: 1, max: 26, optional: false },
    {
      key: "minAttendance",
      label: "Attendance below (%)",
      hint: f.attendance ? "" : "Attendance is off for the school: not checked.",
      min: 1,
      max: 100,
      optional: true,
    },
    {
      key: "masteryBelowLevel",
      label: "Average mastery below level",
      hint: f.mastery ? "" : "Mastery is off for the school: not checked.",
      min: 2,
      max: 10,
      optional: true,
    },
  ];

  async function save(e: FormEvent) {
    e.preventDefault();
    saving.value = true;
    err.value = null;
    try {
      const s = await api<AnalyticsSettings>(PATH, { method: "PUT", body: draft.value });
      loaded.value = s;
      draft.value = s.rules;
      toast.success("At-risk rules saved");
      onSavedAction?.();
    } catch (e2) {
      err.value = userMessage(e2, "Could not save the rules");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>At-risk rules</h2>
        </CardTitle>
        <CardDescription>
          A student is listed when any rule applies. Leave a box empty to switch that rule off. Course pages use these rules at once; the school summaries after the next refresh.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {fields.map((fl) => (
              <div key={fl.key} className="space-y-1.5">
                <Label htmlFor={`ar-${fl.key}`}>{fl.label}</Label>
                <Input
                  id={`ar-${fl.key}`}
                  type="number"
                  inputMode="numeric"
                  min={fl.min}
                  max={fl.max}
                  required={!fl.optional}
                  value={d[fl.key] ?? ""}
                  aria-describedby={fl.hint ? `ar-${fl.key}-hint` : undefined}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    draft.value = {
                      ...d,
                      [fl.key]: raw === "" ? (fl.optional ? null : d[fl.key]) : Number(raw),
                    } as AtRiskRules;
                  }}
                />
                {fl.hint && (
                  <p id={`ar-${fl.key}-hint`} className="text-xs text-muted-foreground">
                    {fl.hint}
                  </p>
                )}
              </div>
            ))}
          </div>
          {err.value && (
            <p role="alert" className="text-sm text-destructive">
              {err.value}
            </p>
          )}
          <Button type="submit" disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Save rules
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
