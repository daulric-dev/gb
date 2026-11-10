"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { ParentSettings } from "@/lib/parent";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const PATH = "/schools/current/parent-settings";

const TOGGLES: { key: keyof Omit<ParentSettings, "maxStudentAge">; label: string }[] = [
  { key: "showGrades", label: "Grades and marked scores" },
  { key: "showWork", label: "Upcoming and missing work" },
  { key: "showAttendance", label: "Attendance" },
  { key: "showAnnouncements", label: "Announcements (course posts and school posts for everyone)" },
  { key: "showReports", label: "Published report cards and transcript" },
  { key: "showMastery", label: "Mastery of learning outcomes (needs Mastery under Features; off by default)" },
];

/** What parents see in the parent portal (school:update). */
export function SchoolParentSettings() {
  useSignals();
  const can = useOptionalCan();
  const allowed = can("school", "update");
  const settings = useSignal<ParentSettings | null>(null);
  const age = useSignal("");

  useEffect(() => {
    if (!allowed) return;
    api<ParentSettings>(PATH)
      .then((s) => {
        settings.value = s;
        age.value = s.maxStudentAge === null ? "" : String(s.maxStudentAge);
      })
      .catch(() => (settings.value = null));
  }, [allowed, settings, age]);

  if (!allowed || !settings.value) return null;

  async function save(patch: Partial<ParentSettings>) {
    try {
      settings.value = await api<ParentSettings>(PATH, { method: "PATCH", body: { settings: patch } });
      toast.success("Saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save"));
    }
  }

  function saveAge() {
    const raw = age.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value === settings.value?.maxStudentAge) return;
    void save({ maxStudentAge: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What parents see</CardTitle>
        <CardDescription>
          Applies in the parent portal (switch the portal on under Features). Parents never see
          submissions, quiz answers, feedback, messages or staff-only data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {TOGGLES.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-4">
            <Label htmlFor={`parent-${t.key}`}>{t.label}</Label>
            <Switch
              id={`parent-${t.key}`}
              checked={settings.value![t.key] ?? false}
              onCheckedChange={(on) => void save({ [t.key]: on })}
            />
          </div>
        ))}
        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="parent-max-age">Leave out students aged</Label>
          <Input
            id="parent-max-age"
            inputMode="numeric"
            className="w-28"
            placeholder="No limit"
            value={age.value}
            onChange={(e) => (age.value = e.target.value.replace(/\D/g, "").slice(0, 2))}
            onBlur={saveAge}
          />
          <p className="text-xs text-muted-foreground">
            Students this age or older (10 to 30) are hidden from their parents. Empty: no limit.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
