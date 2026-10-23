"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Loader2,
  Paperclip,
} from "lucide-react";
import { api } from "@/lib/api";
import { fetchCourseFileBlob } from "@/lib/files/content";
import { cn } from "@/lib/utils";
import type { CourseModule, ModuleItem } from "@/lib/courses/types";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityIcon, EmptyState } from "../../../_components/portal-ui";
import { dueLabel } from "../../../_components/work-types";
import { usePortalCourse } from "../_components/course-context";

export default function PortalCourseModulesPage() {
  useSignals();

  const course = usePortalCourse();
  const modules = useSignal<CourseModule[]>([]);
  const loading = useSignal(true);
  const collapsed = useSignal<Record<string, boolean>>({});

  useEffect(() => {
    api<CourseModule[]>(`/portal/me/courses/${course.id}/modules`)
      .then((data) =>
        (modules.value = [...data].sort((a, b) => a.position - b.position)),
      )
      .catch(() => (modules.value = []))
      .finally(() => (loading.value = false));
  }, [course.id, modules, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (modules.value.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No modules yet"
        description="Your teacher hasn't published any course content. Check back soon."
      />
    );
  }

  return (
    <div className="space-y-4">
      {modules.value.map((m) => {
        const isCollapsed = !!collapsed.value[m.id];
        const items = [...m.items].sort((a, b) => a.position - b.position);
        return (
          <section key={m.id} className="overflow-hidden rounded-xl border">
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() =>
                (collapsed.value = { ...collapsed.value, [m.id]: !isCollapsed })
              }
              className="flex w-full items-center gap-2 bg-muted/60 px-4 py-3 text-left font-semibold transition-colors hover:bg-muted"
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isCollapsed && "-rotate-90",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {items.filter((i) => i.itemType !== "header").length} items
              </span>
            </button>
            {!isCollapsed && (
              <ul className="divide-y">
                {items.length === 0 ? (
                  <li className="px-4 py-4 text-sm text-muted-foreground">
                    Nothing in this module yet.
                  </li>
                ) : (
                  items.map((item) => (
                    <ModuleItemRow
                      key={item.id}
                      item={item}
                      courseId={course.id}
                    />
                  ))
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ModuleItemRow({
  item,
  courseId,
}: {
  item: ModuleItem;
  courseId: string;
}) {
  useSignals();
  const opening = useSignal(false);
  const indent = { paddingLeft: `${1 + Math.min(item.indent, 4) * 1.5}rem` };

  if (item.itemType === "header") {
    return (
      <li
        style={indent}
        className="bg-muted/20 py-2 pr-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {item.title}
      </li>
    );
  }

  const rowClass =
    "flex w-full items-center gap-3 py-3 pr-4 text-left text-sm transition-colors hover:bg-muted/50";

  if (item.itemType === "page" && item.pageId) {
    return (
      <li>
        <Link
          href={`/portal/courses/${courseId}/pages/${item.pageId}`}
          style={indent}
          className={rowClass}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        </Link>
      </li>
    );
  }

  if (item.itemType === "activity" && item.activityId) {
    return (
      <li>
        <Link
          href={`/portal/work/${item.activityId}`}
          style={indent}
          className={rowClass}
        >
          <ActivityIcon
            kind={item.activity?.kind ?? "assignment"}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{item.title}</span>
            {item.activity && (
              <span className="block text-xs text-muted-foreground">
                {dueLabel(item.activity.dueAt)}
              </span>
            )}
          </span>
          {item.activity && (
            <Badge variant="secondary">{item.activity.points} pts</Badge>
          )}
        </Link>
      </li>
    );
  }

  if (item.itemType === "link" && item.url) {
    return (
      <li>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={indent}
          className={rowClass}
        >
          <Link2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
      </li>
    );
  }

  if (item.itemType === "file" && item.fileId) {
    const fileId = item.fileId;
    async function openFile() {
      // Open the tab synchronously so popup blockers allow it, then point it
      // at the file once the bytes arrive.
      const win = window.open("", "_blank");
      opening.value = true;
      try {
        const blob = await fetchCourseFileBlob(courseId, fileId);
        const url = URL.createObjectURL(blob);
        if (win) win.location.href = url;
        else window.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        win?.close();
        toast.error("This file could not be opened. Try again, or ask your teacher.");
      } finally {
        opening.value = false;
      }
    }
    return (
      <li>
        <button
          type="button"
          onClick={openFile}
          disabled={opening.value}
          style={indent}
          className={rowClass}
        >
          {opening.value ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Paperclip className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        </button>
      </li>
    );
  }

  return (
    <li style={indent} className="py-3 pr-4 text-sm text-muted-foreground">
      {item.title}
    </li>
  );
}
