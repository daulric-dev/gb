"use client";

import { Bot, QrCode, Smartphone, UserCog, type LucideIcon } from "lucide-react";
import type {
  AttendanceMethod,
  AttendanceSession,
  AttendanceStatus,
} from "@/lib/courses/types";
import {
  ATTENDANCE_METHOD_LABEL,
  statusColor,
  statusLabel,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AttendanceStatusBadge({
  status,
  className,
}: {
  status: AttendanceStatus | null;
  className?: string;
}) {
  return (
    <Badge className={cn(statusColor(status), className)}>
      {statusLabel(status)}
    </Badge>
  );
}

const COUNT_KEYS: {
  key: keyof AttendanceSession["counts"];
  short: string;
  label: string;
  status: AttendanceStatus | null;
}[] = [
  { key: "present", short: "P", label: "Present", status: "present" },
  { key: "late", short: "L", label: "Late", status: "late" },
  { key: "absent", short: "A", label: "Absent", status: "absent" },
  { key: "excused", short: "E", label: "Excused", status: "excused" },
  { key: "pending", short: "W", label: "Waiting", status: null },
];

/** Small coloured count chips; zero counts and pending-when-closed hidden. */
export function CountBadges({
  counts,
  showPending,
}: {
  counts: AttendanceSession["counts"];
  showPending: boolean;
}) {
  const shown = COUNT_KEYS.filter(
    (c) => counts[c.key] > 0 && (c.key !== "pending" || showPending),
  );
  if (shown.length === 0) {
    return <span className="text-xs text-muted-foreground">No records</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge
          key={c.key}
          className={cn("tabular-nums", statusColor(c.status))}
          title={c.label}
        >
          {c.short} {counts[c.key]}
        </Badge>
      ))}
    </div>
  );
}

const METHOD_ICON: Record<AttendanceMethod, LucideIcon> = {
  self: Smartphone,
  teacher: UserCog,
  auto: Bot,
  qr: QrCode,
};

export function MethodIcon({ method }: { method: AttendanceMethod | null }) {
  if (!method) return <span className="text-muted-foreground/50">-</span>;
  const Icon = METHOD_ICON[method] ?? Bot;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex text-muted-foreground"
            aria-label={ATTENDANCE_METHOD_LABEL[method]}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{ATTENDANCE_METHOD_LABEL[method]}</TooltipContent>
    </Tooltip>
  );
}
