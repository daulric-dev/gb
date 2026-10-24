"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, FileX } from "lucide-react";
import { api } from "@/lib/api";
import type { CoursePage } from "@/lib/courses/types";
import { Markdown } from "@/components/markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../../../../_components/portal-ui";
import { formatDate } from "../../../../_components/types";
import { usePortalCourse } from "../../_components/course-context";

export default function PortalCoursePageView() {
  useSignals();

  const course = usePortalCourse();
  const params = useParams<{ pageId: string }>();
  const pageId = params?.pageId ?? "";

  const page = useSignal<CoursePage | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    if (!pageId) return;
    loading.value = true;
    api<CoursePage>(`/portal/me/courses/${course.id}/pages/${pageId}`)
      .then((data) => (page.value = data))
      .catch(() => (page.value = null))
      .finally(() => (loading.value = false));
  }, [course.id, pageId, page, loading]);

  const back = (
    <Link
      href={`/portal/courses/${course.id}/modules`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Modules
    </Link>
  );

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!page.value) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={FileX}
          title="Page not available"
          description="It may have been unpublished or removed."
        />
      </div>
    );
  }

  return (
    <article className="space-y-4">
      {back}
      <div>
        <h2 className="text-2xl font-bold">{page.value.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Updated {formatDate(page.value.updatedAt)}
        </p>
      </div>
      <Card>
        <CardContent className="py-2">
          {page.value.body?.trim() ? (
            <Markdown className="text-[0.95rem]">{page.value.body}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">This page is empty.</p>
          )}
        </CardContent>
      </Card>
    </article>
  );
}
