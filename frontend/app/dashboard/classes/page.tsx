"use client";

import { useCallback, useEffect } from "react";

import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Plus, Users, BookOpen } from "lucide-react";
import type { ClassItem, AcademicYear } from "./_components/types";
import { ClassTable } from "./_components/ClassTable";
import { CreateClassForm } from "./_components/CreateClassForm";

export default function ClassesPage() {
  useSignals();
  const classes = useSignal<ClassItem[]>([]);
  const yearMap = useSignal<Map<string, string>>(new Map());
  const loading = useSignal(true);
  const dialogOpen = useSignal(false);

  const fetchData = useCallback(() => {
    Promise.all([
      api<ClassItem[]>("/classes").catch(() => [] as ClassItem[]),
      api<(AcademicYear & { is_active?: boolean })[]>("/academic-years").catch(() => [] as (AcademicYear & { is_active?: boolean })[]),
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
