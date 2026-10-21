"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  PenLine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { ActivityKind } from "@/lib/courses/types";
import { dueLabel, isOverdue } from "./work-types";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border py-12", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

export function ActivityIcon({
  kind,
  className,
}: {
  kind: ActivityKind;
  className?: string;
}) {
  if (kind === "quiz") return <ClipboardList className={className} />;
  if (kind === "offline") return <PenLine className={className} />;
  return <FileText className={className} />;
}

export function kindLabel(kind: ActivityKind) {
  if (kind === "quiz") return "Quiz";
  if (kind === "offline") return "On paper";
  return "Assignment";
}

interface WorkLike {
  id: string;
  kind: ActivityKind;
  title: string;
  points: number;
  dueAt: string | null;
  status: string;
  submission: {
    status: "draft" | "submitted" | "graded";
    score: number | null;
    excused?: boolean;
  } | null;
}

/** The badge on the right of a work row: mark, handed in, closed, or points. */
export function WorkStatusBadge({ item }: { item: WorkLike }) {
  const s = item.submission;
  if (s?.excused) return <Badge variant="outline">Excused</Badge>;
  if (s?.status === "graded") {
    return (
      <Badge>
        {s.score ?? "-"}/{item.points}
      </Badge>
    );
  }
  if (s?.status === "submitted") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="size-3" />
        Handed in
      </Badge>
    );
  }
  if (item.kind === "offline") {
    return <Badge variant="outline">{item.points} pts · on paper</Badge>;
  }
  if (item.status === "closed") return <Badge variant="outline">Closed</Badge>;
  if (isOverdue(item.dueAt)) return <Badge variant="destructive">Missing</Badge>;
  return <Badge variant="secondary">{item.points} pts</Badge>;
}

export function WorkRow({
  item,
  context,
  courseHref,
}: {
  item: WorkLike;
  /** Secondary text shown before the due date, such as the course name. */
  context?: string | null;
  courseHref?: string | null;
}) {
  const overdue =
    isOverdue(item.dueAt) &&
    !item.submission &&
    item.status === "published" &&
    item.kind !== "offline";

  return (
    <div className="group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/50">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <ActivityIcon kind={item.kind} className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/portal/work/${item.id}`}
          className="block truncate font-medium after:absolute after:inset-0"
        >
          {item.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {context &&
            (courseHref ? (
              <Link
                href={courseHref}
                className="relative z-10 hover:text-foreground hover:underline"
              >
                {context}
              </Link>
            ) : (
              <span>{context}</span>
            ))}
          {context && " · "}
          <span className={cn(overdue && "text-destructive")}>
            {dueLabel(item.dueAt)}
          </span>
        </p>
      </div>
      <WorkStatusBadge item={item} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
