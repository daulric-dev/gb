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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function ClassTable({ classes, emptyMessage }: { classes: ClassItem[]; emptyMessage: string }) {
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
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {classes.map((cls) => (
            <TableRow key={cls.id}>
              <TableCell className="font-medium">{cls.name}</TableCell>
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
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchClasses = useCallback(() => {
    api<ClassItem[]>("/classes")
      .then(setClasses)
      .catch(() => toast.error("Failed to load classes"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const myClasses = classes.filter((c) => c.isClassTeacher);
  const subjectClasses = classes.filter((c) => !c.isClassTeacher);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">classes</h1>
          <p className="text-muted-foreground mt-1">
            view and manage your assigned classes
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                setDialogOpen(false);
                fetchClasses();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : classes.length === 0 ? (
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
  const [name, setName] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(false);
  const [yearsLoading, setYearsLoading] = useState(true);

  useEffect(() => {
    api<AcademicYear[]>("/academic-years")
      .then((data) => {
        setAcademicYears(data);
        if (data.length > 0) {
          const active = data.find(
            (y: AcademicYear & { is_active?: boolean }) =>
              (y as AcademicYear & { is_active?: boolean }).is_active,
          );
          setAcademicYearId(active?.id || data[0].id);
        }
      })
      .catch(() => toast.error("Failed to load academic years"))
      .finally(() => setYearsLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await api("/classes", {
        method: "POST",
        body: { name, academicYearId },
      });
      toast.success("Class created");
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
        <Label htmlFor="className">Class Name</Label>
        <Input
          id="className"
          placeholder="Class 3A"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="academicYear">Academic Year</Label>
        {yearsLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : academicYears.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No academic years found. Create one first.
          </p>
        ) : (
          <select
            id="academicYear"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            required
          >
            {academicYears.map((y) => (
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
        disabled={loading || academicYears.length === 0}
      >
        {loading ? "Creating..." : "Create Class"}
      </Button>
    </form>
  );
}
