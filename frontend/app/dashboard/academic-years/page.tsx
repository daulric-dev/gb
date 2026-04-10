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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Plus, Pencil } from "lucide-react";

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: "term_based" | "year_based";
  is_active: boolean;
  year_exam_weight: number | null;
  year_coursework_weight: number | null;
}

export default function AcademicYearsPage() {
  useSignals();
  const years = useSignal<AcademicYear[]>([]);
  const loading = useSignal(true);
  const dialogOpen = useSignal(false);
  const editYear = useSignal<AcademicYear | null>(null);

  const fetchYears = useCallback(() => {
    api<AcademicYear[]>("/academic-years")
      .then((data) => (years.value = data))
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  async function handleActivate(id: string) {
    try {
      await api(`/academic-years/${id}/activate`, { method: "PATCH", body: {} });
      toast.success("Academic year activated");
      fetchYears();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to activate";
      toast.error(msg);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await api(`/academic-years/${id}/deactivate`, { method: "PATCH", body: {} });
      toast.success("Academic year deactivated");
      fetchYears();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to deactivate";
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="academic years"
        description={"manage your school's academic years"}
        action={
          <Dialog open={dialogOpen.value} onOpenChange={(v) => (dialogOpen.value = v)}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 size-4" />
              New Academic Year
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Academic Year</DialogTitle>
                <DialogDescription>
                  Add a new academic year for your school
                </DialogDescription>
              </DialogHeader>
              <CreateYearForm
                onSuccess={() => {
                  dialogOpen.value = false;
                  fetchYears();
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : years.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No academic years yet. Create your first one.
        </div>
      ) : (
        <div className="rounded-md border animate-fade-in-up-delay-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.value.map((year) => (
                <TableRow key={year.id}>
                  <TableCell className="font-medium">{year.name}</TableCell>
                  <TableCell>
                    {new Date(year.start_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {new Date(year.end_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {year.grading_model.replace("_", " ")}
                    </Badge>
                    {year.grading_model === "year_based" &&
                      year.year_exam_weight != null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          Exam {year.year_exam_weight}% / CW{" "}
                          {year.year_coursework_weight}%
                        </span>
                      )}
                  </TableCell>
                  <TableCell>
                    {year.is_active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => (editYear.value = year)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {year.is_active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeactivate(year.id)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleActivate(year.id)}
                      >
                        Activate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editYear.value !== null}
        onOpenChange={(open) => {
          if (!open) editYear.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Academic Year</DialogTitle>
            <DialogDescription>
              Update academic year details
            </DialogDescription>
          </DialogHeader>
          {editYear.value && (
            <EditYearForm
              year={editYear.value}
              onSuccess={() => {
                editYear.value = null;
                fetchYears();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateYearForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const name = useSignal("");
  const startDate = useSignal("");
  const endDate = useSignal("");
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const examWeight = useSignal(60);
  const courseworkWeight = useSignal(40);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      startDate: startDate.value,
      endDate: endDate.value,
      gradingModel: gradingModel.value,
    };

    if (gradingModel.value === "year_based") {
      body.yearExamWeight = examWeight.value;
      body.yearCourseworkWeight = courseworkWeight.value;
    }

    try {
      await api("/academic-years", { method: "POST", body });
      toast.success("Academic year created");
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
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="2025/2026"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
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
      <div className="space-y-2">
        <Label htmlFor="gradingModel">Grading Model</Label>
        <select
          id="gradingModel"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={gradingModel.value}
          onChange={(e) =>
            (gradingModel.value = e.target.value as "term_based" | "year_based")
          }
        >
          <option value="term_based">Term Based</option>
          <option value="year_based">Year Based</option>
        </select>
      </div>
      {gradingModel.value === "year_based" && (
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
      )}
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Academic Year"}
      </Button>
    </form>
  );
}

function EditYearForm({
  year,
  onSuccess,
}: {
  year: AcademicYear;
  onSuccess: () => void;
}) {
  useSignals();
  const name = useSignal(year.name);
  const startDate = useSignal(year.start_date);
  const endDate = useSignal(year.end_date);
  const gradingModel = useSignal<"term_based" | "year_based">(year.grading_model);
  const examWeight = useSignal(year.year_exam_weight ?? 60);
  const courseworkWeight = useSignal(year.year_coursework_weight ?? 40);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      startDate: startDate.value,
      endDate: endDate.value,
      gradingModel: gradingModel.value,
    };

    if (gradingModel.value === "year_based") {
      body.yearExamWeight = examWeight.value;
      body.yearCourseworkWeight = courseworkWeight.value;
    } else {
      body.yearExamWeight = null;
      body.yearCourseworkWeight = null;
    }

    try {
      await api(`/academic-years/${year.id}`, { method: "PATCH", body });
      toast.success("Academic year updated");
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
        <Label htmlFor="editName">Name</Label>
        <Input
          id="editName"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
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
      <div className="space-y-2">
        <Label htmlFor="editGradingModel">Grading Model</Label>
        <select
          id="editGradingModel"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={gradingModel.value}
          onChange={(e) =>
            (gradingModel.value = e.target.value as "term_based" | "year_based")
          }
        >
          <option value="term_based">Term Based</option>
          <option value="year_based">Year Based</option>
        </select>
      </div>
      {gradingModel.value === "year_based" && (
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
      )}
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
