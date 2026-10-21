"use client";

import Link from "next/link";
import { Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PortalCourseCard } from "@/lib/courses/types";
import { courseAccent, formatPercent, teacherNames } from "./types";

export function CourseCard({ course }: { course: PortalCourseCard }) {
  const archived = course.status === "archived";
  const teachers = teacherNames(course.teachers);
  const percent = course.grade?.percent ?? null;
  const letter = course.grade?.letter ?? null;

  return (
    <Link
      href={`/portal/courses/${course.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-0 py-0 transition-shadow group-hover:shadow-md">
        <div
          className={cn(
            "relative h-24 bg-gradient-to-br p-4 text-white",
            courseAccent(course.id),
            archived && "grayscale",
          )}
        >
          {course.code && (
            <span className="rounded-md bg-black/20 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
              {course.code}
            </span>
          )}
          {percent !== null && (
            <div className="absolute right-3 bottom-3 rounded-lg bg-background/95 px-2.5 py-1 text-right text-foreground shadow-sm">
              <p className="text-sm leading-tight font-semibold">
                {formatPercent(percent)}
                {letter && (
                  <span className="ml-1 text-muted-foreground">{letter}</span>
                )}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-1 p-4">
          <p className="line-clamp-2 font-semibold leading-snug group-hover:underline">
            {course.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {teachers ?? "No teacher listed"}
          </p>
          {archived && (
            <Badge variant="outline" className="mt-1 gap-1">
              <Archive className="size-3" />
              Archived
            </Badge>
          )}
        </div>
      </Card>
    </Link>
  );
}

export function CourseCardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <Skeleton className="h-24 rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}

export function CourseGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}
