"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useSignal, type Signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  GraduationCap,
  MessageSquareText,
} from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseCard, PortalCourseGrades } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/format-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../_components/portal-ui";
import { formatDate, formatPercent } from "../_components/types";
import {
  GradeBar,
  GroupBreakdown,
  gradeTone,
  isWeighted,
} from "../_components/grade-ui";
import { JoinCourseDialog } from "../_components/join-course-dialog";

type Detail =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; data: PortalCourseGrades };

type GradedItem = PortalCourseGrades["activities"][number];

const RECENT_LIMIT = 5;

export default function PortalGradesPage() {
  useSignals();

  const courses = useSignal<PortalCourseCard[]>([]);
  const loading = useSignal(true);
  const failed = useSignal(false);
  // Per-course grade details, fetched the first time a course is expanded.
  const details = useSignal<Record<string, Detail>>({});

  const load = useCallback(() => {
    loading.value = true;
    failed.value = false;
    api<PortalCourseCard[]>("/portal/me/courses")
      .then((data) => (courses.value = data))
      .catch(() => {
        courses.value = [];
        failed.value = true;
        toast.error("Couldn't load your grades");
      })
      .finally(() => (loading.value = false));
  }, [courses, loading, failed]);

  useEffect(() => {
    load();
  }, [load]);

  const byName = (a: PortalCourseCard, b: PortalCourseCard) =>
    a.name.localeCompare(b.name);
  const current = courses.value
    .filter((c) => c.status === "published")
    .sort(byName);
  const past = courses.value
    .filter((c) => c.status === "archived")
    .sort(byName);

  const graded = current.filter(
    (c) => c.grade?.percent !== null && c.grade?.percent !== undefined,
  );
  const average =
    graded.length > 0
      ? graded.reduce((sum, c) => sum + (c.grade?.percent ?? 0), 0) /
        graded.length
      : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Grades</h1>
          <p className="mt-1 text-muted-foreground">
            How you are doing across your courses
          </p>
        </div>
        {loading.value ? (
          <Skeleton className="h-16 w-48" />
        ) : (
          current.length > 0 && (
            <div className="rounded-xl border px-4 py-2 text-right">
              <p className="text-xs text-muted-foreground">
                Average across courses
              </p>
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  gradeTone(average).text,
                )}
              >
                {average === null ? "—" : formatPercent(average)}
              </p>
              <p className="text-xs text-muted-foreground">
                {graded.length} of {current.length}{" "}
                {current.length === 1 ? "course" : "courses"} graded
              </p>
            </div>
          )
        )}
      </div>

      {loading.value ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CourseGradeSkeleton key={i} />
          ))}
        </div>
      ) : failed.value ? (
        <EmptyState
          icon={GraduationCap}
          title="Grades unavailable"
          description="We couldn't load your grades. Try again shortly."
        >
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        </EmptyState>
      ) : courses.value.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="You're not enrolled in any courses yet"
          description="Join a course with the code your teacher gave you to see your grades here."
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
              current.map((c) => (
                <CourseGradeRow key={c.id} course={c} details={details} />
              ))
            )}
          </section>

          {past.length > 0 && (
            <Collapsible className="space-y-3">
              <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-lg font-semibold">
                <ChevronDown className="size-4 -rotate-90 transition-transform group-data-[panel-open]:rotate-0" />
                Past courses
                <span className="text-sm font-normal text-muted-foreground">
                  ({past.length})
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3">
                {past.map((c) => (
                  <CourseGradeRow
                    key={c.id}
                    course={c}
                    details={details}
                    past
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
}

function CourseGradeRow({
  course,
  details,
  past = false,
}: {
  course: PortalCourseCard;
  details: Signal<Record<string, Detail>>;
  past?: boolean;
}) {
  useSignals();

  const grade = course.grade;
  const percent = grade?.percent ?? null;
  const tone = gradeTone(percent);
  const detail = details.value[course.id];
  const href = `/portal/courses/${course.id}/grades`;

  function setDetail(next: Detail) {
    details.value = { ...details.value, [course.id]: next };
  }

  function fetchDetail() {
    setDetail({ state: "loading" });
    api<PortalCourseGrades>(`/portal/me/courses/${course.id}/grades`)
      .then((data) => setDetail({ state: "ready", data }))
      .catch(() => {
        setDetail({ state: "error" });
        toast.error(`Couldn't load grades for ${course.name}`);
      });
  }

  function onOpenChange(open: boolean) {
    if (open && (!detail || detail.state === "error")) fetchDetail();
  }

  return (
    <Card className="gap-0 py-0">
      <Collapsible onOpenChange={onOpenChange}>
        <div className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <Link
                href={href}
                className="line-clamp-1 font-semibold hover:underline"
              >
                {course.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {[course.code, past ? "Final grade" : null]
                  .filter(Boolean)
                  .join(" · ") || " "}
              </p>
            </div>
            <GradeBar percent={percent} toned />
          </div>

          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <span
                className={cn("text-2xl font-bold tabular-nums", tone.text)}
              >
                {percent === null ? "—" : formatPercent(percent)}
              </span>
              {percent !== null && grade?.letter && (
                <Badge className={cn("text-sm", tone.badge)}>
                  {grade.letter}
                </Badge>
              )}
            </div>
            {percent === null && (
              <p className="text-xs text-muted-foreground">No marks yet</p>
            )}
          </div>

          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Show breakdown for ${course.name}`}
                className="group shrink-0"
              />
            }
          >
            <ChevronDown className="transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="space-y-5 border-t px-4 py-4">
            {grade && grade.groups.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Breakdown</h3>
                <GroupBreakdown
                  groups={grade.groups}
                  weighted={isWeighted(grade)}
                  compact
                />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Recently marked</h3>
                <Link
                  href={href}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  See all
                </Link>
              </div>
              <RecentGraded
                detail={detail}
                onRetry={fetchDetail}
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              render={<Link href={href} />}
              nativeButton={false}
            >
              View details
              <ArrowRight />
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function RecentGraded({
  detail,
  onRetry,
}: {
  detail: Detail | undefined;
  onRetry: () => void;
}) {
  if (!detail || detail.state === "loading") {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (detail.state === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load marked work.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline hover:text-foreground"
        >
          Try again
        </button>
      </p>
    );
  }

  const items = recentGraded(detail.data.activities);
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has been marked yet.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {items.map((a) => (
        <GradedItemRow key={a.id} item={a} />
      ))}
    </ul>
  );
}

function GradedItemRow({ item }: { item: GradedItem }) {
  const s = item.submission;
  const when = s?.submittedAt ?? item.dueAt;
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/portal/work/${item.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {item.title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {item.groupName ?? "Ungrouped"}
            {when && ` · ${formatDate(when)}`}
          </p>
        </div>
        {s?.excused ? (
          <Badge variant="outline">Excused</Badge>
        ) : (
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {formatScore(s?.score)}
            <span className="text-muted-foreground">/{formatScore(item.points)}</span>
          </span>
        )}
      </div>
      {s?.feedback && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <MessageSquareText className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-1">{s.feedback}</span>
        </p>
      )}
    </li>
  );
}

/** The newest marked (or excused) work, by hand-in date then due date. */
function recentGraded(activities: GradedItem[]) {
  const time = (a: GradedItem) => {
    const t = Date.parse(a.submission?.submittedAt ?? a.dueAt ?? "");
    return Number.isNaN(t) ? 0 : t;
  };
  return activities
    .filter((a) => a.submission?.status === "graded" || a.submission?.excused)
    .sort((a, b) => time(b) - time(a))
    .slice(0, RECENT_LIMIT);
}

function CourseGradeSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-1.5 w-full" />
        </div>
        <Skeleton className="h-8 w-20" />
        <Skeleton className="size-8" />
      </CardContent>
    </Card>
  );
}
