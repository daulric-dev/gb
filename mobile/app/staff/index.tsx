import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { UsersRound } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { Tabs } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RoleSection } from "@/features/staff/RoleSection";
import { PendingRequests } from "@/features/staff/PendingRequests";
import { MemberRolesSheet } from "@/features/staff/MemberRolesSheet";
import type {
  JoinRequest,
  MemberRole,
  SchoolMember,
} from "@/features/staff/types";
import { memberName } from "@/features/staff/types";

const ROLE_ORDER: MemberRole[] = ["admin", "teacher", "member"];

type TabValue = "staff" | "pending";

export default function StaffScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = usePermissions();
  const { profile } = useAuth();
  const currentUserId = profile?.id;

  const [members, setMembers] = useState<SchoolMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabValue>("staff");

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<SchoolMember | null>(null);
  const [managing, setManaging] = useState<SchoolMember | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);

  const fetchMembers = useCallback(() => {
    return api<SchoolMember[]>("/schools/members")
      .then((data) => setMembers(data))
      .catch(() => toast.error("Failed to load staff"))
      .finally(() => setLoading(false));
  }, [toast]);

  const fetchRequests = useCallback(() => {
    setRequestsLoading(true);
    return api<JoinRequest[]>("/schools/join-requests")
      .then((data) => setRequests(data))
      .catch(() => toast.error("Failed to load pending requests"))
      .finally(() => setRequestsLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (isAdmin) fetchRequests();
    else setRequestsLoading(false);
  }, [isAdmin, fetchRequests]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const tasks = isAdmin
      ? [fetchMembers(), fetchRequests()]
      : [fetchMembers()];
    Promise.all(tasks).finally(() => setRefreshing(false));
  }, [isAdmin, fetchMembers, fetchRequests]);

  const grouped = useMemo(
    () =>
      ROLE_ORDER.reduce(
        (acc, role) => {
          acc[role] = members.filter((m) => m.role === role);
          return acc;
        },
        {} as Record<MemberRole, SchoolMember[]>,
      ),
    [members],
  );

  const doRemove = async () => {
    if (!confirmRemove) return;
    const member = confirmRemove;
    setRemovingId(member.id);
    try {
      await api(`/schools/members/${member.id}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.success(`${memberName(member.user)} has been removed.`);
      setConfirmRemove(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  };

  const handleManageRoles = (member: SchoolMember) => {
    setManaging(member);
    setRolesOpen(true);
  };

  const staffPanel = loading ? (
    <View style={{ gap: 16 }}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: 88, borderRadius: 16 }} />
      ))}
    </View>
  ) : members.length === 0 ? (
    <EmptyState
      icon={UsersRound}
      title="No staff members yet"
      description="Staff will appear here once they join your school."
    />
  ) : (
    <View style={{ gap: 20 }}>
      {ROLE_ORDER.map((role) => (
        <RoleSection
          key={role}
          role={role}
          members={grouped[role]}
          removingId={removingId}
          currentUserId={currentUserId}
          onRemove={isAdmin ? (m) => setConfirmRemove(m) : undefined}
          onManageRoles={isAdmin ? handleManageRoles : undefined}
        />
      ))}
    </View>
  );

  return (
    <Screen
      title="Staff"
      description="Teachers and administrators at your school"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {isAdmin ? (
        <>
          <Tabs<TabValue>
            tabs={[
              { value: "staff", label: "Staff" },
              {
                value: "pending",
                label: "Pending Members",
                badge: requestsLoading ? undefined : requests.length,
              },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "staff" ? (
            staffPanel
          ) : (
            <PendingRequests
              requests={requests}
              loading={requestsLoading}
              onChange={setRequests}
              onApproved={fetchMembers}
            />
          )}
        </>
      ) : (
        staffPanel
      )}

      <MemberRolesSheet
        open={rolesOpen}
        member={managing}
        onClose={() => setRolesOpen(false)}
        onRolesChanged={fetchMembers}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove member?"
        message={
          confirmRemove
            ? `${memberName(confirmRemove.user)} will be removed from the school.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removingId !== null}
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </Screen>
  );
}
