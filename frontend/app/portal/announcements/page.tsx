"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "../_components/portal-ui";
import { SchoolAnnouncementItem } from "../_components/school-announcements";
import type { PortalAnnouncement } from "../_components/types";

/** The school's announcements for everyone. Course posts stay in each course. */
export default function PortalSchoolAnnouncementsPage() {
  useSignals();
  const items = useSignal<PortalAnnouncement[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalAnnouncement[]>("/portal/me/announcements")
      .then((data) => (items.value = data ?? []))
      .catch(() => (items.value = []))
      .finally(() => (loading.value = false));
  }, [items, loading]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">School announcements</h1>
        <p className="mt-1 text-muted-foreground">
          News from your school. Announcements for a course are in that course.
        </p>
      </div>
      {loading.value ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : items.value.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements"
          description="When your school posts news for everyone it shows up here."
        />
      ) : (
        <div className="space-y-3">
          {items.value.map((a) => (
            <SchoolAnnouncementItem key={a.id} announcement={a} />
          ))}
        </div>
      )}
    </div>
  );
}
