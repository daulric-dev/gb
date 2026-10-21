"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import type { PortalCourseActivity } from "@/lib/courses/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, WorkRow } from "../../../_components/portal-ui";
import {
  bucketActivity,
  byDueDate,
  type CourseActivityBucket,
} from "../../../_components/work-types";
import { usePortalCourse } from "../_components/course-context";

const SECTIONS: { key: CourseActivityBucket; title: string; empty: string }[] = [
  { key: "upcoming", title: "Upcoming", empty: "Nothing coming up." },
  { key: "past", title: "Past due", empty: "" },
  { key: "done", title: "Done", empty: "" },
];

export default function PortalCourseAssignmentsPage() {
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

  if (loading.value) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (activities.value.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No assignments yet"
        description="Assignments and quizzes your teacher sets will appear here."
      />
    );
  }

  const groups: Record<CourseActivityBucket, PortalCourseActivity[]> = {
    upcoming: [],
    past: [],
    done: [],
  };
  for (const a of activities.value) groups[bucketActivity(a)].push(a);
  groups.upcoming.sort(byDueDate);
  groups.past.sort((a, b) => byDueDate(b, a));
  groups.done.sort((a, b) => byDueDate(b, a));

  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const list = groups[section.key];
        if (list.length === 0 && !section.empty) return null;
        return (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {section.title}
                <span className="text-xs font-normal text-muted-foreground">
                  {list.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {section.empty}
                </p>
              ) : (
                list.map((a) => <WorkRow key={a.id} item={a} />)
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
