"use client";

import Link from "next/link";
import { Target } from "lucide-react";
import { useFeatures } from "@/hooks/use-features";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Points school admins at the mastery setup page while `mastery` is on. */
export function SchoolMasteryLink() {
  const { hasFeature } = useFeatures();
  const can = useOptionalCan();
  if (!hasFeature("mastery") || !can("school", "update")) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Mastery &amp; outcomes</CardTitle>
          <CardDescription>Proficiency scale, outcome frameworks and the report card outcomes section.</CardDescription>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/settings/mastery" />}>
          <Target className="mr-2 size-4" aria-hidden />
          Mastery setup
        </Button>
      </CardHeader>
    </Card>
  );
}
