"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Ban } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useProfile } from "@/providers/AuthProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

/** GET/PUT /students/:id/restrictions */
interface StudentRestrictions {
  noAi: boolean;
  noSimilarity: boolean;
  excludeFromAnalytics: boolean;
  /** A staff user id (no name in the response). */
  setBy: string | null;
  setAt: string | null;
}

type Flag = "noAi" | "noSimilarity" | "excludeFromAnalytics";

const FLAGS: { key: Flag; label: string; help: string }[] = [
  {
    key: "noAi",
    label: "No AI processing",
    help: "The student's work is never sent to an AI provider (AI feedback and marking are refused for them).",
  },
  {
    key: "noSimilarity",
    label: "No similarity checks",
    help: "Their submissions are not fingerprinted or compared. Switching it on deletes their existing fingerprints and matches.",
  },
  {
    key: "excludeFromAnalytics",
    label: "Exclude from at-risk lists",
    help: "They are left out of the course and school at-risk lists; switching it on deletes their current at-risk entries. Class counts and averages still include them.",
  },
];

/**
 * A student's restriction / objection flags (`student:update`), for when the
 * student or a parent objects to a kind of processing. Each change is
 * audited by the API.
 */
export function StudentRestrictionsCard({ studentId }: { studentId: string }) {
  useSignals();
  const { profile } = useProfile();
  const data = useSignal<StudentRestrictions | null>(null);
  const failed = useSignal(false);
  const saving = useSignal(false);

  useEffect(() => {
    api<StudentRestrictions>(`/students/${studentId}/restrictions`)
      .then((r) => (data.value = r))
      .catch(() => (failed.value = true));
  }, [studentId, data, failed]);

  async function set(key: Flag, on: boolean) {
    const before = data.value;
    if (!before) return;
    data.value = { ...before, [key]: on };
    saving.value = true;
    try {
      data.value = await api<StudentRestrictions>(`/students/${studentId}/restrictions`, {
        method: "PUT",
        body: { [key]: on },
      });
    } catch (err) {
      data.value = before;
      toast.error(userMessage(err, "Could not save"));
    } finally {
      saving.value = false;
    }
  }

  if (failed.value) return null;
  const r = data.value;
  const by = r?.setBy && r.setBy === profile.value?.id ? " by you" : "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ban className="size-4" aria-hidden="true" />
          Processing restrictions
        </CardTitle>
        <CardDescription>
          When the student or a parent objects to, or asks to restrict, a kind of processing.
          Changes are recorded in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!r ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            {FLAGS.map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor={`restriction-${f.key}`}>{f.label}</Label>
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                </div>
                <Switch
                  id={`restriction-${f.key}`}
                  checked={r[f.key]}
                  disabled={saving.value}
                  onCheckedChange={(on) => void set(f.key, on)}
                />
              </div>
            ))}
            {r.setAt && (
              <p className="text-xs text-muted-foreground">
                Last changed {new Date(r.setAt).toLocaleString()}
                {by}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
