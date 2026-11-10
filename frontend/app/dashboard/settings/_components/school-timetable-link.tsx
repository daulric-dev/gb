"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { useFeatures } from "@/hooks/use-features";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Points school admins at the timetable setup page while `timetable` is on. */
export function SchoolTimetableLink() {
  const { hasFeature } = useFeatures();
  const can = useOptionalCan();
  if (!hasFeature("timetable") || !can("school", "update")) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Timetable</CardTitle>
          <CardDescription>
            Time zone, bell schedule, rooms, closures and automatic attendance.
          </CardDescription>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/settings/timetable" />}>
          <CalendarClock className="mr-2 size-4" aria-hidden />
          Timetable setup
        </Button>
      </CardHeader>
    </Card>
  );
}
