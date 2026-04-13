"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Plus, Users, BookOpen } from "lucide-react";

interface ClassItem {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
  createdAt: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

function ClassTable({ classes, yearMap, emptyMessage }: { classes: ClassItem[]; yearMap: Map<string, string>; emptyMessage: string }) {
  const router = useRouter();

  if (classes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Academic Year</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {classes.map((cls) => (
            <TableRow
              key={cls.id}
              className="cursor-pointer"
              onClick={() => router.push(`/dashboard/classes/${cls.id}`)}
            >
              <TableCell className="font-medium">{cls.name}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {yearMap.get(cls.academicYearId) ?? "-"}
                </Badge>
              </TableCell>
              <TableCell>
                {new Date(cls.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ClassesPage() {
  useSignals();
  const classes = useSignal<ClassItem[]>([]);
  const yearMap = useSignal<Map<string, string>>(new Map());
  const loading = useSignal(true);
  const dialogOpen = useSignal(false);

  const fetchData = useCallback(() => {
    Promise.all([
      api<ClassItem[]>("/classes").catch(() => []),
      api<(AcademicYear & { is_active?: boolean })[]>("/academic-years").catch(() => []),
    ]).then(([cls, years]) => {
      classes.value = cls;
      yearMap.value = new Map(years.map((y) => [y.id, y.name]));
      loading.value = false;
    });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const myClasses = classes.value.filter((c) => c.isClassTeacher);
  const subjectClasses = classes.value.filter((c) => !c.isClassTeacher);

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        title="Classes"
        description="View and Manage Your Assigned Classes"
        action={
          <Dialog open={dialogOpen.value} onOpenChange={(v) => (dialogOpen.value = v)}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 size-4" />
              New Class
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Class</DialogTitle>
                <DialogDescription>
                  Add a new class for an academic year
                </DialogDescription>
              </DialogHeader>
              <CreateClassForm
                onSuccess={() => {
                  dialogOpen.value = false;
                  fetchData();
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {loading.value ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : classes.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No classes yet. Create your first one.
        </div>
      ) : (
        <>
          <Card className="animate-fade-in-up-delay-1">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <CardTitle>My Classes</CardTitle>
              </div>
              <CardDescription>
                Classes where you are the class teacher
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ClassTable
                classes={myClasses}
                yearMap={yearMap.value}
                emptyMessage="You are not a class teacher for any class yet"
              />
            </CardContent>
          </Card>

          <Card className="animate-fade-in-up-delay-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-muted-foreground" />
                <CardTitle>Subjects</CardTitle>
              </div>
              <CardDescription>
                Classes where you teach subjects
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ClassTable
                classes={subjectClasses}
                yearMap={yearMap.value}
                emptyMessage="You are not assigned to teach subjects in any other class"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function CreateClassForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const name = useSignal("");
  const academicYearId = useSignal("");
  const academicYears = useSignal<AcademicYear[]>([]);
  const loading = useSignal(false);
  const yearsLoading = useSignal(true);

  useEffect(() => {
    api<(AcademicYear & { is_active?: boolean })[]>("/academic-years")
      .then((data) => {
        const active = data.filter((y) => y.is_active);
        academicYears.value = active;
        if (active.length > 0) {
          academicYearId.value = active[0].id;
        }
      })
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => (yearsLoading.value = false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/classes", {
        method: "POST",
        body: { name: name.value, academicYearId: academicYearId.value },
      });
      toast.success("Class created");
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
        <Label htmlFor="className">Class Name</Label>
        <Input
          id="className"
          placeholder="Class 3A"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="academicYear">Academic Year</Label>
        {yearsLoading.value ? (
          <Skeleton className="h-9 w-full" />
        ) : academicYears.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No academic years found. Create one first.
          </p>
        ) : (
          <select
            id="academicYear"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={academicYearId.value}
            onChange={(e) => (academicYearId.value = e.target.value)}
            required
          >
            {academicYears.value.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={loading.value || academicYears.value.length === 0}
      >
        {loading.value ? "Creating..." : "Create Class"}
      </Button>
    </form>
  );
}
