"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BookOpen, CalendarClock, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useProfile } from "@/providers/AuthProvider";
import type { PortalCourseCard } from "@/lib/courses/types";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseCard, CourseCardSkeleton, CourseGrid } from "./_components/course-card";
import { JoinCourseDialog } from "./_components/join-course-dialog";
import { EmptyState, WorkRow } from "./_components/portal-ui";
import {
  byDueDate,
  isOutstanding,
  type PortalWorkItem,
} from "./_components/work-types";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function PortalDashboardPage() {
  useSignals();

  const { profile } = useProfile();
  const courses = useSignal<PortalCourseCard[]>([]);
  const work = useSignal<PortalWorkItem[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    Promise.all([
      api<PortalCourseCard[]>("/portal/me/courses").catch(() => []),
      api<PortalWorkItem[]>("/portal/me/activities").catch(() => []),
    ])
      .then(([courseData, workData]) => {
        courses.value = courseData ?? [];
        work.value = workData ?? [];
      })
      .finally(() => (loading.value = false));
  }, [courses, work, loading]);

  const firstName = profile.value?.first_name ?? null;
  const active = courses.value.filter((c) => c.status !== "archived");
  const todo = work.value.filter(isOutstanding).sort(byDueDate);
  const shown = todo.slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {loading.value
              ? "Loading your courses"
              : todo.length === 0
                ? "You're all caught up."
                : `You have ${todo.length} thing${todo.length === 1 ? "" : "s"} to do.`}
          </p>
        </div>
        <JoinCourseDialog variant="outline" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your courses</h2>
          {courses.value.length > active.length && (
            <Link
              href="/portal/courses"
              className="text-sm font-medium text-primary hover:underline"
            >
              All courses
            </Link>
          )}
        </div>

        {loading.value ? (
          <CourseGrid>
            <CourseCardSkeleton />
            <CourseCardSkeleton />
            <CourseCardSkeleton />
          </CourseGrid>
        ) : active.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No courses yet"
            description="When a teacher adds you to a course it shows up here. Have a join code? Use it to add yourself."
          >
            <JoinCourseDialog />
          </EmptyState>
        ) : (
          <CourseGrid>
            {active.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </CourseGrid>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-muted-foreground" />
            To do
          </CardTitle>
          {todo.length > shown.length && (
            <CardAction>
              <Link
                href="/portal/work"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all ({todo.length})
              </Link>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {loading.value ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="size-8 text-emerald-500" />
              Nothing due. Nice work.
            </div>
          ) : (
            shown.map((item) => (
              <WorkRow
                key={item.id}
                item={item}
                context={item.courseName}
                courseHref={
                  item.courseId ? `/portal/courses/${item.courseId}` : null
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
