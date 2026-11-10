"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { AlertSettings } from "@/lib/attendance-reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PATH = "/attendance-alerts/settings";

const SWITCHES: { key: keyof AlertSettings; label: string; hint: string }[] = [
  { key: "notifyTutor", label: "Tell the form tutor", hint: "The student's form tutor (set below)." },
  { key: "notifyAdmins", label: "Tell the school admin", hint: "" },
  { key: "emailStaff", label: "Email staff", hint: "Alerts always appear on this page; this also emails them." },
  {
    key: "notifyParents",
    label: "Tell parents",
    hint: "Only when the parent portal and parent notifications are on, the school shows attendance to parents, and the parent chose attendance alerts.",
  },
];

/** The school's thresholds (school:update); hidden when the API says 403. */
export function AlertSettingsCard() {
  useSignals();
  const settings = useSignal<AlertSettings | null>(null);
  const draft = useSignal<AlertSettings | null>(null);
  const saving = useSignal(false);
  const err = useSignal<string | null>(null);

  useEffect(() => {
    api<AlertSettings>(PATH)
      .then((s) => {
        settings.value = s;
        draft.value = s;
      })
      .catch(() => (settings.value = null));
  }, [settings, draft]);

  if (!settings.value || !draft.value) return null;
  const d = draft.value;
  const set = (patch: Partial<AlertSettings>) => (draft.value = { ...draft.value!, ...patch });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    saving.value = true;
    err.value = null;
    try {
      settings.value = await api<AlertSettings>(PATH, { method: "PUT", body: draft.value });
      draft.value = settings.value;
      toast.success("Alert settings saved");
    } catch (e2) {
      err.value = userMessage(e2, "Could not save the alert settings");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert thresholds</CardTitle>
        <CardDescription>
          Checked every hour. Leave a threshold empty to switch that check off; nothing is alerted until one is set.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="al-rate">Alert below (%)</Label>
              <Input
                id="al-rate"
                type="number"
                min={1}
                max={100}
                placeholder="Off"
                value={d.minRate ?? ""}
                onChange={(e) => set({ minRate: num(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-window">Over the last (days)</Label>
              <Input
                id="al-window"
                type="number"
                min={7}
                max={120}
                value={d.windowDays}
                onChange={(e) => set({ windowDays: Number(e.target.value) || 28 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-min">Once there are at least (sessions)</Label>
              <Input
                id="al-min"
                type="number"
                min={1}
                max={100}
                value={d.minSessions}
                onChange={(e) => set({ minSessions: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-run">Absences in a row</Label>
              <Input
                id="al-run"
                type="number"
                min={2}
                max={30}
                placeholder="Off"
                value={d.consecutiveAbsences ?? ""}
                onChange={(e) => set({ consecutiveAbsences: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SWITCHES.map((s) => (
              <div key={s.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div>
                  <Label htmlFor={`al-${s.key}`}>{s.label}</Label>
                  {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
                </div>
                <Switch
                  id={`al-${s.key}`}
                  checked={d[s.key] as boolean}
                  onCheckedChange={(v) => set({ [s.key]: v } as Partial<AlertSettings>)}
                />
              </div>
            ))}
          </div>
          {err.value && (
            <p role="alert" className="text-sm text-destructive">
              {err.value}
            </p>
          )}
          <Button type="submit" disabled={saving.value}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save thresholds
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
