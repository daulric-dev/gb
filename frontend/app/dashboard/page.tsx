"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDashboard } from "./_components/AdminDashboard";
import { TeacherDashboard } from "./_components/TeacherDashboard";
import type { DashboardSummary } from "./_components/types";

type DashboardMode = "admin-only" | "teacher-only" | "both";

function pickMode(isAdmin: boolean, summary: DashboardSummary | null): DashboardMode {
  const teaches = (summary?.myCourses.length ?? 0) > 0;
  if (isAdmin && teaches) return "both";
  if (isAdmin) return "admin-only";
  return "teacher-only";
}

export default function DashboardPage() {
  useSignals();
  const { profile, loading: profileLoading } = useProfile();
  const { isAdmin: isSchoolAdmin } = usePermissions();
  const summary = useSignal<DashboardSummary | null>(null);
  const summaryLoading = useSignal(true);

  useEffect(() => {
    api<DashboardSummary>("/dashboard/summary")
      .then((data) => (summary.value = data))
      .catch(() => (summary.value = null))
      .finally(() => (summaryLoading.value = false));
  }, [summary, summaryLoading]);

  const displayName = profile.value?.first_name
    ? profile.value.first_name
    : "there";

  const ready = !profileLoading.value && !summaryLoading.value;
  const isAdmin = summary.value?.isAdmin ?? isSchoolAdmin;
  const mode: DashboardMode | null = ready
    ? pickMode(isAdmin, summary.value)
    : null;

  const admin = (
    <AdminDashboard
      school={summary.value?.school ?? null}
      activeYear={summary.value?.activeYear ?? null}
    />
  );
  const teacher = (
    <TeacherDashboard
      courses={summary.value?.myCourses ?? []}
      awaitingMarking={summary.value?.awaitingMarking ?? 0}
    />
  );

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
        admin
      ) : mode === "teacher-only" ? (
        teacher
      ) : (
        <Tabs defaultValue="teacher">
          <TabsList className="w-full">
            <TabsTrigger value="teacher">My Courses</TabsTrigger>
            <TabsTrigger value="admin">School Overview</TabsTrigger>
          </TabsList>
          <TabsContent value="teacher" className="mt-4">
            {teacher}
          </TabsContent>
          <TabsContent value="admin" className="mt-4">
            {admin}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
