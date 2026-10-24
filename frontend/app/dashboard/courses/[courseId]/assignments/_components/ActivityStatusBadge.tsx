import { ClipboardList, FileText, NotebookPen, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_STATUS_LABEL } from "@/lib/courses/format";
import type { ActivityKind, ActivityStatus } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  quiz: ClipboardList,
  assignment: FileText,
  offline: NotebookPen,
};

const STYLE: Record<ActivityStatus, string> = {
  published:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  draft: "bg-muted text-muted-foreground border-transparent",
  closed: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-transparent",
};

export function ActivityStatusBadge({
  status,
  className,
}: {
  status: ActivityStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(STYLE[status], className)}>
      {ACTIVITY_STATUS_LABEL[status]}
    </Badge>
  );
}
