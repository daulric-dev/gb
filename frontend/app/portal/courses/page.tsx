"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BookOpen } from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseCard } from "@/lib/courses/types";
import {
  CourseCard,
  CourseCardSkeleton,
  CourseGrid,
} from "../_components/course-card";
import { JoinCourseDialog } from "../_components/join-course-dialog";
import { EmptyState } from "../_components/portal-ui";

export default function PortalCoursesPage() {
  useSignals();

  const courses = useSignal<PortalCourseCard[]>([]);
  const loading = useSignal(true);

  const load = useCallback(() => {
    api<PortalCourseCard[]>("/portal/me/courses")
      .then((data) => (courses.value = data))
      .catch(() => (courses.value = []))
      .finally(() => (loading.value = false));
  }, [courses, loading]);

  useEffect(() => {
    load();
  }, [load]);

  const byName = (a: PortalCourseCard, b: PortalCourseCard) =>
    a.name.localeCompare(b.name);
  const current = courses.value.filter((c) => c.status !== "archived").sort(byName);
  const past = courses.value.filter((c) => c.status === "archived").sort(byName);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Courses</h1>
          <p className="mt-1 text-muted-foreground">
            Everything you are enrolled in
          </p>
        </div>
        <JoinCourseDialog onJoined={load} />
      </div>

      {loading.value ? (
        <CourseGrid>
          {Array.from({ length: 6 }).map((_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </CourseGrid>
      ) : courses.value.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="You're not in any courses yet"
          description="Ask your teacher for a join code, or wait for them to add you."
        >
          <JoinCourseDialog onJoined={load} />
        </EmptyState>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Current courses</h2>
            {current.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No current courses.
              </p>
            ) : (
              <CourseGrid>
                {current.map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </CourseGrid>
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Past courses</h2>
              <CourseGrid>
                {past.map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </CourseGrid>
            </section>
          )}
        </>
      )}
    </div>
  );
}
