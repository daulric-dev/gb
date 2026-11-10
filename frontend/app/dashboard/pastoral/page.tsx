"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import {
  notesQuery,
  type NoteFilters,
  type PastoralAbilities,
  type PastoralCategory,
  type PastoralNote,
} from "@/lib/pastoral";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NoteFilterBar, NoteList } from "./_components/NoteList";

/**
 * Pastoral notes for staff: "My follow-ups" (open notes assigned to me) and,
 * for staff with pastoral-note:read, every note in the school with filters
 * and the CSV export. Notes are added from a student's page.
 */
export default function PastoralPage() {
  useSignals();
  const me = useSignal<PastoralAbilities | null>(null);
  const categories = useSignal<PastoralCategory[]>([]);
  const followUps = useSignal<PastoralNote[] | null>(null);
  const notes = useSignal<PastoralNote[] | null>(null);
  const filters = useSignal<NoteFilters>({ status: "open" });

  useEffect(() => {
    api<PastoralAbilities>("/pastoral/me").then((m) => (me.value = m)).catch(() => undefined);
    api<PastoralCategory[]>("/pastoral/categories").then((c) => (categories.value = c)).catch(() => undefined);
  }, [me, categories]);

  const loadFollowUps = useCallback(() => {
    api<PastoralNote[]>("/pastoral/follow-ups")
      .then((n) => (followUps.value = n))
      .catch(() => (followUps.value = []));
  }, [followUps]);

  const query = notesQuery(filters.value);
  const loadNotes = useCallback(() => {
    if (!me.value?.canRead) return;
    api<PastoralNote[]>(`/pastoral/notes${query}`)
      .then((n) => (notes.value = n))
      .catch(() => (notes.value = []));
  }, [me.value?.canRead, query, notes]);

  useEffect(() => loadFollowUps(), [loadFollowUps]);
  useEffect(() => loadNotes(), [loadNotes]);

  async function exportCsv() {
    try {
      await downloadFromUrl(`/pastoral/export${query}`, "pastoral-notes.csv");
    } catch (err) {
      toast.error(userMessage(err, "Failed to export"));
    }
  }

  const refresh = () => {
    loadFollowUps();
    loadNotes();
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Pastoral notes"
        description="Private staff notes about students. Never shown to students or parents."
        action={
          me.value?.canManageSettings ? (
            <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/pastoral/settings" />}>
              <Settings className="mr-2 size-4" aria-hidden="true" />
              Categories and retention
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="follow-ups">
        <TabsList>
          <TabsTrigger value="follow-ups">My follow-ups</TabsTrigger>
          {me.value?.canRead && <TabsTrigger value="all">All notes</TabsTrigger>}
        </TabsList>

        <TabsContent value="follow-ups" className="pt-4">
          {followUps.value === null ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <NoteList
              notes={followUps.value}
              showStudent
              onChangedAction={refresh}
              emptyText="Nothing assigned to you. Notes appear here when a colleague assigns you a follow-up."
            />
          )}
        </TabsContent>

        {me.value?.canRead && (
          <TabsContent value="all" className="space-y-4 pt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Filters</CardTitle>
                <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
                  <Download className="mr-2 size-4" aria-hidden="true" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                <NoteFilterBar
                  idPrefix="school-notes"
                  value={filters.value}
                  onChangeAction={(v) => (filters.value = v)}
                  categories={categories.value}
                />
              </CardContent>
            </Card>
            {notes.value === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <NoteList notes={notes.value} showStudent onChangedAction={refresh} emptyText="No notes match." />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
