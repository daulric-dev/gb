"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useComputed, useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Pencil, Plus } from "lucide-react";
import { sortYearsActiveFirst, type AcademicYear } from "./_components/types";
import { CreateYearForm } from "./_components/CreateYearForm";
import { EditYearForm } from "./_components/EditYearForm";
import { TermsTab } from "./_components/TermsTab";

export default function AcademicYearsPage() {
  useSignals();
  const years = useSignal<AcademicYear[]>([]);
  const loading = useSignal(true);
  const dialogOpen = useSignal(false);
  const editYear = useSignal<AcademicYear | null>(null);

  const sortedYears = useComputed(() => sortYearsActiveFirst(years.value));

  const fetchYears = useCallback(() => {
    loading.value = true;
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

  const yearsPanel = (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog
          open={dialogOpen.value}
          onOpenChange={(v) => (dialogOpen.value = v)}
        >
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
      </div>

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : sortedYears.value.length === 0 ? (
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
              {sortedYears.value.map((year) => (
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
    </div>
  );

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Academic Calendar"
        description="Manage academic years and the terms within each year"
      />

      <Tabs defaultValue="years">
        <TabsList className="w-full">
          <TabsTrigger value="years">Academic Years</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
        </TabsList>
        <TabsContent value="years" className="mt-4">
          {yearsPanel}
        </TabsContent>
        <TabsContent value="terms" className="mt-4">
          <TermsTab years={sortedYears.value} yearsLoading={loading.value} />
        </TabsContent>
      </Tabs>

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
