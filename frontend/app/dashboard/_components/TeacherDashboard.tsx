"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  FilePen,
  Inbox,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Activity } from "@/lib/courses/types";
import {
  ACTIVITY_KIND_LABEL,
  courseColor,
  formatDue,
} from "@/lib/courses/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CourseCard } from "@/app/dashboard/courses/_components/CourseCard";
import { StatCard } from "./StatCard";
import type { DashboardCourse } from "./types";

/** How many courses to scan for upcoming work; enough for a teacher's load. */
const SCAN_LIMIT = 12;

type DueItem = Activity & { course: DashboardCourse };

/**
 * The teaching view: the caller's live courses, what is due next across them,
 * and drafts still waiting to go out.
 */
export function TeacherDashboard({
  courses,
  awaitingMarking,
}: {
  courses: DashboardCourse[];
  awaitingMarking: number;
}) {
  useSignals();

  const due = useSignal<DueItem[]>([]);
  const draftWork = useSignal(0);
  const loadingWork = useSignal(true);

  const active = courses.filter((c) => c.status !== "archived");

  useEffect(() => {
    const scan = courses
      .filter((c) => c.status !== "archived")
      .slice(0, SCAN_LIMIT);
    if (scan.length === 0) {
      loadingWork.value = false;
      return;
    }

    void Promise.all(
      scan.map((course) =>
        api<Activity[]>(`/courses/${course.id}/activities`)
          .then((list) => list.map((a) => ({ ...a, course })))
          .catch(() => [] as DueItem[]),
      ),
    ).then((lists) => {
      const all = lists.flat();
      const now = Date.now();
      due.value = all
        .filter(
          (a) =>
            a.status === "published" &&
            a.dueAt &&
            new Date(a.dueAt).getTime() >= now,
        )
        .sort(
          (a, b) =>
            new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime(),
        )
        .slice(0, 8);
      draftWork.value = all.filter((a) => a.status === "draft").length;
      loadingWork.value = false;
    });
  }, [courses, due, draftWork, loadingWork]);

  if (courses.length === 0) {
    return (
      <Empty className="animate-fade-in-up border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>No courses yet</EmptyTitle>
          <EmptyDescription>
            Courses you teach or assist in show up here, with what is due next.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link href="/dashboard/courses" />}>
            Go to courses
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const students = active.reduce((sum, c) => sum + (c.studentCount ?? 0), 0);
  const draftCourses = active.filter((c) => c.status === "draft").length;
  const drafts = draftWork.value + draftCourses;

  return (
    <div className="space-y-8">
      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={BookOpen} value={active.length} label="Active courses" />
        <StatCard icon={Users} value={students} label="Enrolled students" />
        <StatCard
          icon={CalendarClock}
          value={due.value.length}
          label="Due soon"
          loading={loadingWork.value}
        />
        <StatCard
          icon={Inbox}
          value={awaitingMarking}
          label="Awaiting marking"
        />
      </div>

      <div className="grid animate-fade-in-up-delay-2 gap-6 xl:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">My courses</h2>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/dashboard/courses" />}
            >
              All courses
              <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.slice(0, 6).map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        </section>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
            <CardDescription>
              Published work due next
              {!loadingWork.value && drafts > 0 && (
                <span className="flex items-center gap-1 pt-1">
                  <FilePen className="size-3.5" />
                  {drafts} {drafts === 1 ? "draft" : "drafts"} not yet published
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {loadingWork.value ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))
            ) : due.value.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing due. Enjoy the quiet.
              </p>
            ) : (
              due.value.map((a) => (
                <Link
                  key={a.id}
                  href={`/dashboard/courses/${a.course.id}/assignments/${a.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ background: courseColor(a.course.id) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.course.code || a.course.name} ·{" "}
                      {ACTIVITY_KIND_LABEL[a.kind]} · {formatDue(a.dueAt)}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
