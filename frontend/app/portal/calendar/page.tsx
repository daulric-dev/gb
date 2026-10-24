"use client";

import { api } from "@/lib/api";
import type { PortalCalendarItem } from "@/lib/courses/types";
import { DueCalendar } from "@/components/calendar/due-calendar";
import { WorkStatusBadge } from "../_components/portal-ui";

function loadRange(from: string, to: string) {
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return api<PortalCalendarItem[]>(`/portal/me/calendar?${qs}`);
}

/** The student's due dates across their courses, by month. */
export default function PortalCalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Calendar</h1>
        <p className="mt-1 text-muted-foreground">
          When work is due across all your courses
        </p>
      </div>
      <DueCalendar<PortalCalendarItem>
        load={loadRange}
        hrefFor={(item) => `/portal/work/${item.activityId}`}
        badgeFor={(item) => (
          <WorkStatusBadge item={{ ...item, id: item.activityId }} />
        )}
        icsPath="/portal/me/calendar/ics"
      />
    </div>
  );
}
