"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { HeartHandshake, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useFeatures } from "@/hooks/use-features";
import {
  notesQuery,
  type NoteFilters,
  type PastoralAbilities,
  type PastoralCategory,
  type PastoralNote,
} from "@/lib/pastoral";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoteDialog } from "@/app/dashboard/pastoral/_components/NoteDialog";
import { NoteFilterBar, NoteList } from "@/app/dashboard/pastoral/_components/NoteList";

/**
 * A student's pastoral timeline (feature `pastoral_notes`): every note the
 * caller may see about them, newest first, with filters and "Add a note".
 * Hidden for staff without any pastoral permission.
 */
export function PastoralTimelineCard({ studentId, studentName }: { studentId: string; studentName: string }) {
  useSignals();
  const on = useFeatures().hasFeature("pastoral_notes");
  const me = useSignal<PastoralAbilities | null>(null);
  const notes = useSignal<PastoralNote[]>([]);
  const categories = useSignal<PastoralCategory[]>([]);
  const filters = useSignal<NoteFilters>({});
  const adding = useSignal(false);

  useEffect(() => {
    if (!on) return;
    api<PastoralAbilities>("/pastoral/me").then((m) => (me.value = m)).catch(() => (me.value = null));
    api<PastoralCategory[]>("/pastoral/categories").then((c) => (categories.value = c)).catch(() => undefined);
  }, [on, me, categories]);

  const allowed = !!me.value && (me.value.canRead || me.value.canCreate || me.value.canUpdate);
  const query = notesQuery(filters.value);
  const load = useCallback(() => {
    if (!allowed) return;
    api<PastoralNote[]>(`/pastoral/students/${studentId}/notes${query}`)
      .then((n) => (notes.value = n))
      .catch(() => (notes.value = []));
  }, [allowed, studentId, query, notes]);

  useEffect(() => load(), [load]);

  if (!on || !allowed) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="size-4" aria-hidden="true" />
          Pastoral notes
        </CardTitle>
        {me.value?.canCreate && (
          <Button size="sm" variant="outline" onClick={() => (adding.value = true)}>
            <Plus className="mr-1 size-4" aria-hidden="true" />
            Add a note
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {me.value?.canRead
            ? "Private to staff with the pastoral permissions; never shown to the student or their parents."
            : "You can see the notes you wrote."}
        </p>
        <NoteFilterBar
          idPrefix="student-notes"
          value={filters.value}
          onChangeAction={(v) => (filters.value = v)}
          categories={categories.value}
        />
        <NoteList notes={notes.value} onChangedAction={load} emptyText="No notes yet." />
      </CardContent>
      <NoteDialog
        open={adding.value}
        onOpenChangeAction={(v) => (adding.value = v)}
        studentId={studentId}
        studentName={studentName}
        onSavedAction={() => load()}
      />
    </Card>
  );
}
