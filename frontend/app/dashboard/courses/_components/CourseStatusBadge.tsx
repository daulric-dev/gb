import { Badge } from "@/components/ui/badge";
import { COURSE_STATUS_LABEL } from "@/lib/courses/format";
import type { CourseStatus } from "@/lib/courses/types";
import { cn } from "@/lib/utils";

const STYLE: Record<CourseStatus, string> = {
  published:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent",
  archived: "bg-muted text-muted-foreground border-transparent",
};

export function CourseStatusBadge({
  status,
  className,
}: {
  status: CourseStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(STYLE[status], className)}>
      {COURSE_STATUS_LABEL[status]}
    </Badge>
  );
}
