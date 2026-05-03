"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/lib/use-profile";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Users } from "lucide-react";
import type { SchoolMember } from "./_components/types";
import { RoleSection } from "./_components/RoleSection";

const ROLE_ORDER: SchoolMember["role"][] = ["admin", "teacher", "member"];

function StaffSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2].map((j) => (
              <Skeleton key={j} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffEmpty() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="mb-3 size-10 text-muted-foreground/40" />
        <p className="font-medium">No staff members yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff will appear here once they join your school.
        </p>
      </CardContent>
    </Card>
  );
}

export default function StaffPage() {
  useSignals();

  const { profile } = useProfile();
  const members = useSignal<SchoolMember[]>([]);
  const loading = useSignal(true);
  const removingId = useSignal<string | null>(null);
  const isAdmin = profile.value?.role === "admin";

  const grouped = useComputed(() =>
    ROLE_ORDER.reduce(
      (acc, role) => {
        acc[role] = members.value.filter((m) => m.role === role);
        return acc;
      },
      {} as Record<SchoolMember["role"], SchoolMember[]>,
    ),
  );

  useEffect(() => {
    api<SchoolMember[]>("/schools/members")
      .then((data) => (members.value = data))
      .catch(() => toast.error("Failed to load staff"))
      .finally(() => (loading.value = false));
  }, []);

  const handleRemove = useCallback(
    async (member: SchoolMember) => {
      const name = member.user
        ? [member.user.first_name, member.user.last_name].filter(Boolean).join(" ") || "This member"
        : "This member";

      if (!window.confirm(`Remove ${name} from the school?`)) return;

      removingId.value = member.id;
      try {
        await api(`/schools/members/${member.id}`, { method: "DELETE" });
        members.value = members.value.filter((m) => m.id !== member.id);
        toast.success(`${name} has been removed.`);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to remove member";
        toast.error(message);
      } finally {
        removingId.value = null;
      }
    },
    [],
  );

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Staff"
        description="View teachers and administrators at your school"
      />

      {loading.value ? (
        <StaffSkeleton />
      ) : members.value.length === 0 ? (
        <StaffEmpty />
      ) : (
        <div className="space-y-6">
          {ROLE_ORDER.map((role) => (
            <RoleSection
              key={role}
              role={role}
              members={grouped.value[role]}
              removingId={removingId.value}
              currentUserId={profile.value?.id}
              onRemove={isAdmin ? handleRemove : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
