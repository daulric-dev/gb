"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar, Pencil, Plus, Trash2 } from "lucide-react";
import { termLabel, type AcademicYear, type Term } from "./types";
import { CreateTermForm } from "./CreateTermForm";
import { EditTermForm } from "./EditTermForm";

const TERM_SLOTS = 3;

function YearSectionSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function TermsTab({
  years,
  yearsLoading,
}: {
  years: AcademicYear[];
  yearsLoading: boolean;
}) {
  useSignals();

  const termsByYear = useSignal<Record<string, Term[]>>({});
  const loading = useSignal(true);
  const createForYear = useSignal<AcademicYear | null>(null);
  const editTerm = useSignal<Term | null>(null);

  const fetchAllTerms = useCallback(async () => {
    if (years.length === 0) {
      termsByYear.value = {};
      loading.value = false;
      return;
    }

    loading.value = true;
    try {
      const results = await Promise.all(
        years.map(async (y) => {
          const data = await api<Term[]>(`/terms?yearId=${y.id}`);
          return [y.id, data] as const;
        }),
      );
      termsByYear.value = Object.fromEntries(results);
    } catch {
      toast.error("Failed to load terms");
    } finally {
      loading.value = false;
    }
  }, [years]);

  useEffect(() => {
    fetchAllTerms();
  }, [fetchAllTerms]);

  async function handleDelete(term: Term) {
    if (!confirm(`Delete ${termLabel[term.name]} term? This cannot be undone.`))
      return;

    try {
      await api(`/terms/${term.id}`, { method: "DELETE" });
      toast.success("Term deleted");
      fetchAllTerms();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete";
      toast.error(msg);
    }
  }

  if (yearsLoading || loading.value) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <YearSectionSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No academic years yet. Create one in the Academic Years tab first.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {years.map((year) => {
        const yearTerms = termsByYear.value[year.id] ?? [];
        const canAdd = yearTerms.length < TERM_SLOTS;
        const isYearBased = year.grading_model === "year_based";

        return (
          <section
            key={year.id}
            className="space-y-3 rounded-lg border p-4 animate-fade-in-up-delay-1"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{year.name}</h2>
                {year.is_active ? (
                  <Badge>Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
                <Badge variant="outline" className="capitalize">
                  {year.grading_model.replace("_", " ")}
                </Badge>
              </div>
              <Button
                size="sm"
                onClick={() => (createForYear.value = year)}
                disabled={!canAdd || isYearBased}
                title={
                  isYearBased
                    ? "Year-based grading does not use terms"
                    : !canAdd
                      ? "Maximum of 3 terms per year"
                      : undefined
                }
              >
                <Plus className="mr-1.5 size-3.5" />
                Add Term
              </Button>
            </div>

            {isYearBased ? (
              <p className="text-sm text-muted-foreground">
                This academic year uses year-based grading and does not have
                terms.
              </p>
            ) : yearTerms.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No terms for this academic year yet.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Term</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Exam / CW</TableHead>
                      <TableHead>Ministry</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearTerms.map((term) => (
                      <TableRow key={term.id}>
                        <TableCell className="font-medium">
                          {termLabel[term.name]}
                        </TableCell>
                        <TableCell>
                          {new Date(term.start_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {new Date(term.end_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {term.exam_weight}% / {term.coursework_weight}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {term.is_ministry_reporting ? (
                            <Badge>Yes</Badge>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => (editTerm.value = term)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(term)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        );
      })}

      <Dialog
        open={createForYear.value !== null}
        onOpenChange={(open) => {
          if (!open) createForYear.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Term</DialogTitle>
            <DialogDescription>
              Add a term to {createForYear.value?.name ?? "the selected year"}
            </DialogDescription>
          </DialogHeader>
          {createForYear.value && (
            <CreateTermForm
              academicYearId={createForYear.value.id}
              existingNames={
                (termsByYear.value[createForYear.value.id] ?? []).map(
                  (t) => t.name,
                )
              }
              onSuccess={() => {
                createForYear.value = null;
                fetchAllTerms();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editTerm.value !== null}
        onOpenChange={(open) => {
          if (!open) editTerm.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Term</DialogTitle>
            <DialogDescription>Update term details</DialogDescription>
          </DialogHeader>
          {editTerm.value && (
            <EditTermForm
              term={editTerm.value}
              onSuccess={() => {
                editTerm.value = null;
                fetchAllTerms();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
