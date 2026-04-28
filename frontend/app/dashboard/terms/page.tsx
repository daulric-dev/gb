"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { type AcademicYear, type Term, selectClass, termLabel } from "./_components/types";
import { CreateTermForm } from "./_components/CreateTermForm";
import { EditTermForm } from "./_components/EditTermForm";

export default function TermsPage() {
  useSignals();
  const years = useSignal<AcademicYear[]>([]);
  const selectedYearId = useSignal("");
  const terms = useSignal<Term[]>([]);
  const loading = useSignal(true);
  const termsLoading = useSignal(false);
  const createOpen = useSignal(false);
  const editTerm = useSignal<Term | null>(null);

  useEffect(() => {
    api<AcademicYear[]>("/academic-years")
      .then((data) => {
        years.value = data;
        const active = data.find((y) => y.is_active);
        if (active) selectedYearId.value = active.id;
        else if (data.length > 0) selectedYearId.value = data[0].id;
      })
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => (loading.value = false));
  }, []);

  const fetchTerms = useCallback((yearId: string) => {
    if (!yearId) return;
    termsLoading.value = true;
    api<Term[]>(`/terms?yearId=${yearId}`)
      .then((data) => (terms.value = data))
      .catch(() => toast.error("Failed to load terms"))
      .finally(() => (termsLoading.value = false));
  }, []);

  useEffect(() => {
    if (selectedYearId.value) fetchTerms(selectedYearId.value);
  }, [selectedYearId.value, fetchTerms]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${termLabel[name]} term? This cannot be undone.`)) return;

    try {
      await api(`/terms/${id}`, { method: "DELETE" });
      toast.success("Term deleted");
      fetchTerms(selectedYearId.value);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete";
      toast.error(msg);
    }
  }

  const existingTermNames = terms.value.map((t) => t.name);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Terms"
        description="Manage Terms for Each Academic Year"
        action={
          <Dialog open={createOpen.value} onOpenChange={(v) => (createOpen.value = v)}>
            <DialogTrigger
              render={
                <Button disabled={!selectedYearId.value || existingTermNames.length >= 3} />
              }
            >
              <Plus className="mr-2 size-4" />
              New Term
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Term</DialogTitle>
                <DialogDescription>
                  Add a term to the selected academic year
                </DialogDescription>
              </DialogHeader>
              <CreateTermForm
                academicYearId={selectedYearId.value}
                existingNames={existingTermNames}
                onSuccess={() => {
                  createOpen.value = false;
                  fetchTerms(selectedYearId.value);
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {loading.value ? (
        <Skeleton className="h-9 w-full" />
      ) : years.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No academic years yet. Create one first.
        </div>
      ) : (
        <>
          <div className="animate-fade-in-up-delay-1">
            <Label htmlFor="yearSelect" className="sr-only">Academic Year</Label>
            <select
              id="yearSelect"
              className={selectClass}
              value={selectedYearId.value}
              onChange={(e) => (selectedYearId.value = e.target.value)}
            >
              {years.value.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_active ? "(Active)" : ""}
                </option>
              ))}
            </select>
          </div>

          {termsLoading.value ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : terms.value.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No terms for this academic year yet.
            </div>
          ) : (
            <div className="rounded-md border animate-fade-in-up-delay-1">
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
                  {terms.value.map((term) => (
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
                          onClick={() => handleDelete(term.id, term.name)}
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
        </>
      )}

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
                fetchTerms(selectedYearId.value);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
