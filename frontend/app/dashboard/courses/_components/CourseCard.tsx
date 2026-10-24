import Link from "next/link";
import { CalendarRange, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COURSE_ROLE_LABEL, courseGradient } from "@/lib/courses/format";
import type { Course } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { CourseStatusBadge } from "./CourseStatusBadge";

/** What a card needs; the dashboard summary's course rows satisfy it too. */
export type CourseCardData = Pick<
  Course,
  "id" | "name" | "code" | "status" | "role" | "studentCount"
> & {
  /** Handed-in work not yet marked, when known. */
  awaitingMarking?: number;
  /** A school template; the dashboard summary leaves it out. */
  isTemplate?: boolean;
};

export function CourseCard({
  course,
  termLabel,
}: {
  course: CourseCardData;
  /** "2026/27 · Term 1", resolved by the caller from the calendar. */
  termLabel?: string | null;
}) {
  return (
    <Link
      href={`/dashboard/courses/${course.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card
        className={cn(
          "h-full gap-0 overflow-hidden py-0 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md",
          course.status === "archived" && "opacity-70",
        )}
      >
        <div
          className="relative h-24 shrink-0"
          style={{ background: courseGradient(course.id) }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.25),transparent_55%)]" />
          {course.code && (
            <span className="absolute bottom-2 left-3 rounded-md bg-black/25 px-2 py-0.5 font-mono text-xs font-medium text-white backdrop-blur-sm">
              {course.code}
            </span>
          )}
          <div className="absolute top-2 right-2 flex gap-1">
            {course.isTemplate && (
              <Badge
                variant="secondary"
                className="bg-background/90 backdrop-blur-sm"
              >
                Template
              </Badge>
            )}
            <CourseStatusBadge
              status={course.status}
              className="bg-background/90 backdrop-blur-sm"
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
            {course.name}
          </h3>
          {termLabel && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarRange className="size-3.5" />
              <span className="truncate">{termLabel}</span>
            </p>
          )}
          <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {course.studentCount}{" "}
              {course.studentCount === 1 ? "student" : "students"}
            </span>
            <span className="flex items-center gap-1.5">
              {!!course.awaitingMarking && (
                <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                  {course.awaitingMarking} to mark
                </Badge>
              )}
              <Badge variant="secondary">{COURSE_ROLE_LABEL[course.role]}</Badge>
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function CourseCardSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Skeleton className="h-24 rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-4 h-3 w-1/3" />
      </div>
    </Card>
  );
}
