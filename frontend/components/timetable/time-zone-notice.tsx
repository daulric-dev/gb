"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Warns that the school has no time zone yet: days and times are UTC and no
 * check-in opens automatically. Renders nothing unless `timeZoneSet` is
 * explicitly false. Admins (school:update) get a link to the setup page.
 */
export function TimeZoneNotice({
  timeZoneSet,
  context = "timetable",
}: {
  timeZoneSet: boolean | undefined;
  context?: "timetable" | "reports";
}) {
  const can = useOptionalCan();
  if (timeZoneSet !== false) return null;
  const canSet = can("school", "update");
  return (
    <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <TriangleAlert aria-hidden />
      <AlertTitle>School time zone not set</AlertTitle>
      <AlertDescription>
        {context === "reports"
          ? "Report days are counted in UTC until it is set, so sessions near midnight may land on the wrong day."
          : "Times are shown in UTC and check-in will not open automatically until it is set."}{" "}
        {canSet ? (
          <Link href="/dashboard/settings/timetable" className="font-medium underline underline-offset-2">
            Set the time zone
          </Link>
        ) : (
          "Ask a school admin to set it in Timetable setup."
        )}
      </AlertDescription>
    </Alert>
  );
}
