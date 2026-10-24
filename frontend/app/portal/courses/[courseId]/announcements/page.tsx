"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { Markdown } from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../../../_components/portal-ui";
import {
  formatDateTime,
  type PortalAnnouncement,
} from "../../../_components/types";
import { usePortalCourse } from "../_components/course-context";

export default function PortalCourseAnnouncementsPage() {
  useSignals();

  const course = usePortalCourse();
  const items = useSignal<PortalAnnouncement[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalAnnouncement[]>(`/portal/me/courses/${course.id}/announcements`)
      .then((data) => (items.value = data))
      .catch(() => (items.value = []))
      .finally(() => (loading.value = false));
  }, [course.id, items, loading]);

  if (loading.value) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (items.value.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No announcements"
        description="Updates from your teacher will show up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.value.map((a) => {
        const first = a.author?.first_name ?? null;
        const last = a.author?.last_name ?? null;
        const name = [first, last].filter(Boolean).join(" ") || "Teacher";
        const initials =
          [first?.[0], last?.[0]].filter(Boolean).join("").toUpperCase() || "?";
        return (
          <Card key={a.id}>
            <CardHeader className="flex flex-row items-start gap-3">
              <Avatar className="size-9">
                {a.author?.avatar_url && (
                  <AvatarImage src={a.author.avatar_url} alt="" />
                )}
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {name} · {formatDateTime(a.created_at)}
                </p>
              </div>
            </CardHeader>
            {a.body && (
              <CardContent>
                <Markdown className="text-muted-foreground">{a.body}</Markdown>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
