"use client";

import { api } from "@/lib/api";
import type { CalendarItem } from "@/lib/courses/types";
import { Badge } from "@/components/ui/badge";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DueCalendar } from "@/components/calendar/due-calendar";

function loadRange(from: string, to: string) {
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return api<CalendarItem[]>(`/calendar?${qs}`);
}

/** Due dates across every course the caller teaches or assists. */
export default function StaffCalendarPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Calendar"
        description="Due dates across the courses you teach, drafts included"
      />
      <DueCalendar<CalendarItem>
        load={loadRange}
        hrefFor={(item) =>
          `/dashboard/courses/${item.courseId}/assignments/${item.activityId}`
        }
        badgeFor={(item) =>
          item.status === "draft" ? (
            <Badge variant="outline">Draft</Badge>
          ) : item.status === "closed" ? (
            <Badge variant="outline">Closed</Badge>
          ) : (
            <Badge variant="secondary">{item.points} pts</Badge>
          )
        }
        icsPath="/calendar/ics"
      />
    </div>
  );
}
