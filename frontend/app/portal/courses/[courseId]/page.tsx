"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CalendarClock, CheckCircle2, Info, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseActivity } from "@/lib/courses/types";
import { Markdown } from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkRow } from "../../_components/portal-ui";
import { formatPercent, personName } from "../../_components/types";
import {
  byDueDate,
  isOutstanding,
} from "../../_components/work-types";
import { usePortalCourse } from "./_components/course-context";

export default function PortalCourseHomePage() {
  useSignals();

  const course = usePortalCourse();
  const activities = useSignal<PortalCourseActivity[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalCourseActivity[]>(`/portal/me/courses/${course.id}/activities`)
      .then((data) => (activities.value = data))
      .catch(() => (activities.value = []))
      .finally(() => (loading.value = false));
  }, [course.id, activities, loading]);

  const upcoming = activities.value.filter(isOutstanding).sort(byDueDate);
  const base = `/portal/courses/${course.id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-muted-foreground" />
              About this course
            </CardTitle>
          </CardHeader>
          <CardContent>
            {course.description?.trim() ? (
              <Markdown>{course.description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your teacher hasn&apos;t added a description yet. Head to{" "}
                <Link href={`${base}/modules`} className="text-primary hover:underline">
                  Modules
                </Link>{" "}
                to find the course content.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-muted-foreground" />
              Coming up
            </CardTitle>
            <CardAction>
              <Link
                href={`${base}/assignments`}
                className="text-sm font-medium text-primary hover:underline"
              >
                All assignments
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading.value ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="size-7 text-emerald-500" />
                Nothing to hand in for this course.
              </div>
            ) : (
              upcoming.slice(0, 5).map((a) => <WorkRow key={a.id} item={a} />)
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {course.grade?.percent != null && (
          <Link href={`${base}/grades`} className="block">
            <Card className="transition-colors hover:bg-muted/40">
              <CardContent>
                <p className="text-xs text-muted-foreground">Current grade</p>
                <p className="text-3xl font-semibold">
                  {formatPercent(course.grade.percent)}
                  {course.grade.letter && (
                    <span className="ml-2 text-lg text-muted-foreground">
                      {course.grade.letter}
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>
          </Link>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" />
              Teachers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {course.teachers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teacher listed.</p>
            ) : (
              course.teachers.map((t, i) => {
                const name = personName(t);
                const initials =
                  [t.firstName?.[0], t.lastName?.[0]]
                    .filter(Boolean)
                    .join("")
                    .toUpperCase() || "?";
                return (
                  <div key={t.userProfileId ?? i} className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {t.avatarUrl && <AvatarImage src={t.avatarUrl} alt="" />}
                      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.role === "ta" ? "Teaching assistant" : "Teacher"}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
