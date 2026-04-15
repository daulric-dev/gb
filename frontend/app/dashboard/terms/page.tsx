"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface AcademicYear {
  id: string;
  name: string;
  is_active: boolean;
}

interface Term {
  id: string;
  academic_year_id: string;
  name: "michaelmas" | "hilary" | "trinity";
  start_date: string;
  end_date: string;
  exam_weight: number;
  coursework_weight: number;
  is_ministry_reporting: boolean;
  sort_order: number;
}

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const termLabel: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

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

function CreateTermForm({academicYearId, existingNames, onSuccess}: {academicYearId: string; existingNames: string[]; onSuccess: () => void}) {
  useSignals();
  const availableNames = (["michaelmas", "hilary", "trinity"] as const).filter(
    (n) => !existingNames.includes(n),
  );
  const name = useSignal(availableNames[0] ?? "michaelmas");
  const startDate = useSignal("");
  const endDate = useSignal("");
  const examWeight = useSignal(60);
  const courseworkWeight = useSignal(40);
  const isMinistryReporting = useSignal(false);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/terms", {
        method: "POST",
        body: {
          academicYearId,
          name: name.value,
          startDate: startDate.value,
          endDate: endDate.value,
          examWeight: examWeight.value,
          courseworkWeight: courseworkWeight.value,
          isMinistryReporting: isMinistryReporting.value,
        },
      });
      toast.success("Term created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="termName">Term</Label>
        <select
          id="termName"
          className={selectClass}
          value={name.value}
          onChange={(e) => (name.value = e.target.value as "michaelmas" | "hilary" | "trinity")}
          required
        >
          {availableNames.map((n) => (
            <option key={n} value={n}>
              {termLabel[n]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate.value}
            onChange={(e) => (startDate.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate.value}
            onChange={(e) => (endDate.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="examWeight">Exam Weight (%)</Label>
          <Input
            id="examWeight"
            type="number"
            min={0}
            max={100}
            value={examWeight.value}
            onChange={(e) => (examWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cwWeight">Coursework Weight (%)</Label>
          <Input
            id="cwWeight"
            type="number"
            min={0}
            max={100}
            value={courseworkWeight.value}
            onChange={(e) => (courseworkWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <p className="col-span-2 text-xs text-muted-foreground">
          Weights must add up to 100%
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="ministry"
          type="checkbox"
          checked={isMinistryReporting.value}
          onChange={(e) => (isMinistryReporting.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="ministry">Ministry Reporting Term</Label>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading.value || availableNames.length === 0}
      >
        {loading.value ? "Creating..." : "Create Term"}
      </Button>
    </form>
  );
}

function EditTermForm({term, onSuccess}: {term: Term; onSuccess: () => void}) {
  useSignals();
  const startDate = useSignal(term.start_date);
  const endDate = useSignal(term.end_date);
  const examWeight = useSignal(term.exam_weight);
  const courseworkWeight = useSignal(term.coursework_weight);
  const isMinistryReporting = useSignal(term.is_ministry_reporting);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api(`/terms/${term.id}`, {
        method: "PATCH",
        body: {
          startDate: startDate.value,
          endDate: endDate.value,
          examWeight: examWeight.value,
          courseworkWeight: courseworkWeight.value,
          isMinistryReporting: isMinistryReporting.value,
        },
      });
      toast.success("Term updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Term</Label>
        <p className="text-sm font-medium">{termLabel[term.name]}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editStartDate">Start Date</Label>
          <Input
            id="editStartDate"
            type="date"
            value={startDate.value}
            onChange={(e) => (startDate.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editEndDate">End Date</Label>
          <Input
            id="editEndDate"
            type="date"
            value={endDate.value}
            onChange={(e) => (endDate.value = e.target.value)}
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editExamWeight">Exam Weight (%)</Label>
          <Input
            id="editExamWeight"
            type="number"
            min={0}
            max={100}
            value={examWeight.value}
            onChange={(e) => (examWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCwWeight">Coursework Weight (%)</Label>
          <Input
            id="editCwWeight"
            type="number"
            min={0}
            max={100}
            value={courseworkWeight.value}
            onChange={(e) => (courseworkWeight.value = Number(e.target.value))}
            required
          />
        </div>
        <p className="col-span-2 text-xs text-muted-foreground">
          Weights must add up to 100%
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="editMinistry"
          type="checkbox"
          checked={isMinistryReporting.value}
          onChange={(e) => (isMinistryReporting.value = e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="editMinistry">Ministry Reporting Term</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
