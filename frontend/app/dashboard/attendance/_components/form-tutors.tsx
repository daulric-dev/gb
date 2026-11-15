"use client";

import { useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import type { FormTutors } from "@/lib/attendance-reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PATH = "/attendance-alerts/form-tutors";
const SHOWN = 200;

/** Assign form tutors (student:update); hidden when the API says 403. */
export function FormTutorsCard() {
  useSignals();
  const data = useSignal<FormTutors | null>(null);
  const filter = useSignal("");
  const selected = useSignal<Set<string>>(new Set());
  const tutorId = useSignal("");
  const saving = useSignal(false);

  const load = useCallback(async function load() {
    try {
      data.value = await api<FormTutors>(PATH);
    } catch {
      data.value = null;
    }
  }, [data]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data.value) return null;
  const staffName = new Map(data.value.staff.map((s) => [s.id, personName(s)]));
  const needle = filter.value.trim().toLowerCase();
  const matching = data.value.students.filter(
    (s) =>
      !needle ||
      personName(s).toLowerCase().includes(needle) ||
      (s.formTutorId && (staffName.get(s.formTutorId) ?? "").toLowerCase().includes(needle)),
  );
  const shown = matching.slice(0, SHOWN);

  function toggle(id: string, on: boolean) {
    const next = new Set(selected.value);
    if (on) next.add(id);
    else next.delete(id);
    selected.value = next;
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (selected.value.size === 0) return;
    saving.value = true;
    try {
      await api(PATH, {
        method: "PUT",
        body: { studentIds: [...selected.value], tutorId: tutorId.value || null },
      });
      toast.success(tutorId.value ? "Form tutor assigned" : "Form tutor cleared");
      selected.value = new Set();
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Could not save the form tutor"));
    } finally {
      saving.value = false;
    }
  }

  const allShownSelected = shown.length > 0 && shown.every((s) => selected.value.has(s.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form tutors</CardTitle>
        <CardDescription>
          A form tutor gets their tutees&apos; attendance alerts and can open their reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={assign} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ft-filter">Find students</Label>
            <Input
              id="ft-filter"
              type="search"
              value={filter.value}
              onChange={(e) => (filter.value = e.target.value)}
              placeholder="Name or tutor"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ft-tutor">Form tutor</Label>
            <NativeSelect id="ft-tutor" value={tutorId.value} onChange={(e) => (tutorId.value = e.target.value)}>
              <NativeSelectOption value="">No form tutor</NativeSelectOption>
              {data.value.staff.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {personName(s)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={saving.value || selected.value.size === 0}>
            {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Set for {selected.value.size} selected
          </Button>
        </form>

        {matching.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students match.</p>
        ) : (
          <div className="rounded-lg border">
            <label className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={allShownSelected}
                onChange={(e) => {
                  const next = new Set(selected.value);
                  for (const s of shown) {
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                  }
                  selected.value = next;
                }}
              />
              Select all shown
            </label>
            <ul className="max-h-96 divide-y overflow-y-auto">
              {shown.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-3 px-4 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.value.has(s.id)}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate" translate="no">{personName(s)}</span>
                    <span className="truncate text-xs text-muted-foreground" translate={s.formTutorId ? "no" : undefined}>
                      {s.formTutorId ? (staffName.get(s.formTutorId) ?? "Former staff") : "No form tutor"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {matching.length > SHOWN && (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Showing {SHOWN} of {matching.length}. Narrow the search to see more.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
