"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CheckSquare } from "lucide-react";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, WorkRow } from "../_components/portal-ui";
import {
  byDueDate,
  isOutstanding,
  type PortalWorkItem,
} from "../_components/work-types";

export default function PortalWorkPage() {
  useSignals();

  const items = useSignal<PortalWorkItem[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalWorkItem[]>("/portal/me/activities")
      .then((data) => (items.value = data))
      .catch(() => (items.value = []))
      .finally(() => (loading.value = false));
  }, [items, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const todo = items.value.filter(isOutstanding).sort(byDueDate);
  const done = items.value
    .filter((i) => !isOutstanding(i))
    .sort((a, b) => byDueDate(b, a));

  const row = (item: PortalWorkItem) => (
    <WorkRow
      key={item.id}
      item={item}
      context={item.courseName}
      courseHref={item.courseId ? `/portal/courses/${item.courseId}` : null}
    />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">To-do</h1>
        <p className="mt-1 text-muted-foreground">
          Quizzes and assignments across all your courses
        </p>
      </div>

      {items.value.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="Nothing set right now"
          description="New quizzes and assignments from your courses will appear here."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                To do
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {todo.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {todo.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              ) : (
                todo.map(row)
              )}
            </CardContent>
          </Card>

          {done.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Done and closed
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {done.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">{done.map(row)}</CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
