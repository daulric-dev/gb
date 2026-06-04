"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { RefreshCw, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JoinRequest, SchoolMember } from "./_components/types";
import { RoleSection } from "./_components/RoleSection";
import { PendingRequestsTab } from "./_components/PendingRequestsTab";
import { MemberRolesDialog } from "./_components/MemberRolesDialog";

const ROLE_ORDER: SchoolMember["role"][] = ["admin", "teacher", "member"];

function RefreshButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
    >
      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      Refresh
    </Button>
  );
}

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
  const requests = useSignal<JoinRequest[]>([]);
  const requestsLoading = useSignal(true);
  const managingMember = useSignal<SchoolMember | null>(null);
  const rolesDialogOpen = useSignal(false);
  const isAdmin = profile.value?.role === "admin";

  const handleManageRoles = useCallback((member: SchoolMember) => {
    managingMember.value = member;
    rolesDialogOpen.value = true;
  }, []);

  const grouped = useComputed(() =>
    ROLE_ORDER.reduce(
      (acc, role) => {
        acc[role] = members.value.filter((m) => m.role === role);
        return acc;
      },
      {} as Record<SchoolMember["role"], SchoolMember[]>,
    ),
  );

  const fetchMembers = useCallback(() => {
    loading.value = true;
    api<SchoolMember[]>("/schools/members")
      .then((data) => (members.value = data))
      .catch(() => toast.error("Failed to load staff"))
      .finally(() => (loading.value = false));
  }, []);

  const fetchRequests = useCallback(() => {
    requestsLoading.value = true;
    api<JoinRequest[]>("/schools/join-requests")
      .then((data) => (requests.value = data))
      .catch(() => toast.error("Failed to load pending requests"))
      .finally(() => (requestsLoading.value = false));
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (isAdmin) {
      fetchRequests();
    } else {
      requestsLoading.value = false;
    }
  }, [isAdmin, fetchRequests]);

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

  const staffPanel = loading.value ? (
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
          onManageRoles={isAdmin ? handleManageRoles : undefined}
        />
      ))}
    </div>
  );

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Staff"
          description="View teachers and administrators at your school"
          action={
            <RefreshButton
              onClick={fetchMembers}
              loading={loading.value}
              label="Refresh staff"
            />
          }
        />
        {staffPanel}
      </div>
    );
  }

  const pendingCount = requests.value.length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Staff"
        description="View teachers and administrators at your school"
      />

      <Tabs defaultValue="staff">
        <TabsList className="w-full">
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="pending">
            Pending Members
            {!requestsLoading.value && pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <RefreshButton
              onClick={fetchMembers}
              loading={loading.value}
              label="Refresh staff"
            />
          </div>
          {staffPanel}
        </TabsContent>
        <TabsContent value="pending" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <RefreshButton
              onClick={fetchRequests}
              loading={requestsLoading.value}
              label="Refresh pending members"
            />
          </div>
          <PendingRequestsTab
            requests={requests.value}
            loading={requestsLoading.value}
            onChange={(next) => (requests.value = next)}
            onApproved={fetchMembers}
          />
        </TabsContent>
      </Tabs>

      <MemberRolesDialog
        open={rolesDialogOpen.value}
        member={managingMember.value}
        onOpenChange={(v) => (rolesDialogOpen.value = v)}
      />
    </div>
  );
}
