"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, ClipboardList, FileText } from "lucide-react";
import {
  dueLabel,
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
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const todo = items.value.filter(isOutstanding);
  const done = items.value.filter((i) => !isOutstanding(i));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Work</h1>
        <p className="mt-1 text-muted-foreground">
          Quizzes and assignments set for your classes
        </p>
      </div>

      {items.value.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nothing set right now.
          </CardContent>
        </Card>
      ) : (
        <>
          {todo.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">To do</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {todo.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </CardContent>
            </Card>
          )}

          {done.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Done</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {done.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function WorkRow({ item }: { item: PortalWorkItem }) {
  const Icon = item.kind === "quiz" ? ClipboardList : FileText;
  const submission = item.submission;

  return (
    <Link href={`/portal/work/${item.id}`}>
      <div className="flex items-center gap-3 rounded-md border px-3 py-3 transition-colors hover:bg-muted/50">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            {item.subject?.name ? `${item.subject.name} · ` : ""}
            {dueLabel(item.dueAt)}
          </p>
        </div>

        {submission?.status === "graded" ? (
          <Badge>
            {submission.score}/{item.points}
          </Badge>
        ) : submission?.status === "submitted" ? (
          <Badge variant="secondary">Handed in</Badge>
        ) : item.status === "closed" ? (
          <Badge variant="outline">Closed</Badge>
        ) : (
          <Badge variant="secondary">{item.points} pts</Badge>
        )}

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
