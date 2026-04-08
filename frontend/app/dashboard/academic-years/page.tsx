"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
import { Plus } from "lucide-react";

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
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchYears = useCallback(() => {
    api<AcademicYear[]>("/academic-years")
      .then(setYears)
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => setLoading(false));
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
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">academic years</h1>
          <p className="text-muted-foreground mt-1">
            manage your school&apos;s academic years
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                setDialogOpen(false);
                fetchYears();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : years.length === 0 ? (
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
              {years.map((year) => (
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
                  <TableCell className="text-right">
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
    </div>
  );
}

function CreateYearForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [gradingModel, setGradingModel] = useState<
    "term_based" | "year_based"
  >("term_based");
  const [examWeight, setExamWeight] = useState(60);
  const [courseworkWeight, setCourseworkWeight] = useState(40);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      name,
      startDate,
      endDate,
      gradingModel,
    };

    if (gradingModel === "year_based") {
      body.yearExamWeight = examWeight;
      body.yearCourseworkWeight = courseworkWeight;
    }

    try {
      await api("/academic-years", { method: "POST", body });
      toast.success("Academic year created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          placeholder="2025/2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="gradingModel">Grading Model</Label>
        <select
          id="gradingModel"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={gradingModel}
          onChange={(e) =>
            setGradingModel(e.target.value as "term_based" | "year_based")
          }
        >
          <option value="term_based">Term Based</option>
          <option value="year_based">Year Based</option>
        </select>
      </div>
      {gradingModel === "year_based" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="examWeight">Exam Weight (%)</Label>
            <Input
              id="examWeight"
              type="number"
              min={0}
              max={100}
              value={examWeight}
              onChange={(e) => setExamWeight(Number(e.target.value))}
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
              value={courseworkWeight}
              onChange={(e) => setCourseworkWeight(Number(e.target.value))}
              required
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Weights must add up to 100%
          </p>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Create Academic Year"}
      </Button>
    </form>
  );
}
