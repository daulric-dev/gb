"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDashboard } from "./_components/AdminDashboard";
import { TeacherDashboard } from "./_components/TeacherDashboard";

interface ClassItem {
  id: string;
  name: string | null;
  academicYearId: string | null;
  isClassTeacher: boolean | null;
}

type DashboardMode = "admin-only" | "teacher-only" | "both";

function pickMode(
  role: string | null | undefined,
  classes: ClassItem[],
): DashboardMode {
  const isAdmin = role === "admin";
  const hasClasses = classes.length > 0;

  if (isAdmin && hasClasses) return "both";
  if (isAdmin) return "admin-only";
  return "teacher-only";
}

export default function DashboardPage() {
  useSignals();
  const { profile, loading: profileLoading } = useProfile();
  const classes = useSignal<ClassItem[]>([]);
  const classesLoading = useSignal(true);

  useEffect(() => {
    api<ClassItem[]>("/classes")
      .then((data) => (classes.value = data))
      .catch(() => (classes.value = []))
      .finally(() => (classesLoading.value = false));
  }, []);

  const displayName = profile.value?.first_name
    ? profile.value.first_name
    : "there";

  const ready = !profileLoading.value && !classesLoading.value;
  const mode: DashboardMode | null = ready
    ? pickMode(profile.value?.role, classes.value)
    : null;

  return (
    <div className="space-y-8">
      <div className="animate-fade-in-up">
        {profileLoading.value ? (
          <Skeleton className="h-9 w-48" />
        ) : (
          <h1 className="text-3xl font-bold">Hello {displayName}</h1>
        )}
      </div>

      {!ready ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : mode === "admin-only" ? (
        <AdminDashboard />
      ) : mode === "teacher-only" ? (
        <TeacherDashboard classes={classes.value} />
      ) : (
        <Tabs defaultValue="admin">
          <TabsList className="w-full">
            <TabsTrigger value="admin">School Overview</TabsTrigger>
            <TabsTrigger value="teacher">My Classes</TabsTrigger>
          </TabsList>
          <TabsContent value="admin" className="mt-4">
            <AdminDashboard />
          </TabsContent>
          <TabsContent value="teacher" className="mt-4">
            <TeacherDashboard classes={classes.value} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
