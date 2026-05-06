"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/use-profile";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminDashboard } from "./_components/AdminDashboard";
import { TeacherDashboard } from "./_components/TeacherDashboard";

interface ClassItem {
  id: string;
  name: string | null;
  academicYearId: string | null;
  isClassTeacher: boolean | null;
}

function shouldShowTeacherView(
  role: string | null | undefined,
  classes: ClassItem[],
): boolean {
  if (role !== "admin") return true;
  return classes.some((c) => c.isClassTeacher === true);
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
  const showTeacherView = ready
    ? shouldShowTeacherView(profile.value?.role, classes.value)
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
      ) : showTeacherView ? (
        <TeacherDashboard classes={classes.value} />
      ) : (
        <AdminDashboard classCount={classes.value.length} />
      )}
    </div>
  );
}
