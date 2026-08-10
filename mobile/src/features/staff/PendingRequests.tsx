import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Check, UsersRound, X } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import type { JoinRequest, MemberRole } from "./types";
import { requestName } from "./types";

const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: "member", label: "Member" },
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
];

export function PendingRequests({
  requests,
  loading,
  onChange,
  onApproved,
}: {
  requests: JoinRequest[];
  loading: boolean;
  onChange: (next: JoinRequest[]) => void;
  onApproved?: () => void;
}) {
  const toast = useToast();
  const { colors } = useTheme();

  const [approveOpen, setApproveOpen] = useState(false);
  const [selected, setSelected] = useState<JoinRequest | null>(null);
  const [selectedRole, setSelectedRole] = useState<MemberRole>("member");
  const [actionLoading, setActionLoading] = useState(false);

  const openApprove = (request: JoinRequest) => {
    setSelected(request);
    setSelectedRole("member");
    setApproveOpen(true);
  };

  const handleApprove = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api(`/schools/join-requests/${selected.id}/approve`, {
        method: "PATCH",
        body: { role: selectedRole },
      });
      onChange(requests.filter((r) => r.id !== selected.id));
      setApproveOpen(false);
      toast.success(`${requestName(selected)} has been approved as ${selectedRole}.`);
      onApproved?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to approve request");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (request: JoinRequest) => {
    setActionLoading(true);
    try {
      await api(`/schools/join-requests/${request.id}/reject`, {
        method: "PATCH",
      });
      onChange(requests.filter((r) => r.id !== request.id));
      toast.success(`${requestName(request)}'s request has been rejected.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to reject request");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 96, borderRadius: 16 }} />
        ))}
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No pending join requests"
        description="When someone requests to join your school, it will appear here."
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {requests.map((request) => (
        <Card key={request.id}>
          <CardContent style={styles.card}>
            <View style={styles.info}>
              <Text weight="600">{requestName(request)}</Text>
              {request.user?.email ? (
                <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={1}>
                  {request.user.email}
                </Text>
              ) : null}
              {request.message ? (
                <Text variant="muted" style={{ fontStyle: "italic" }}>
                  “{request.message}”
                </Text>
              ) : null}
              <Text variant="muted" style={{ fontSize: 12 }}>
                Requested {formatDate(request.requested_at)}
              </Text>
            </View>
            <View style={styles.actions}>
              <Button
                size="sm"
                disabled={actionLoading}
                onPress={() => openApprove(request)}
                icon={<Check size={16} color={colors.primaryForeground} />}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onPress={() => handleReject(request)}
                icon={<X size={16} color={colors.foreground} />}
              >
                Reject
              </Button>
            </View>
          </CardContent>
        </Card>
      ))}

      <Sheet
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Approve Join Request"
        description={
          selected
            ? `Assign a role to ${requestName(selected)}.`
            : "Assign a role to this user."
        }
      >
        <View style={{ gap: 6 }}>
          <Label>Role</Label>
          <Select
            value={selectedRole}
            options={ROLE_OPTIONS}
            onChange={(v) => setSelectedRole(v)}
          />
        </View>
        <Button loading={actionLoading} onPress={handleApprove}>
          Confirm
        </Button>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  info: {
    gap: 2,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
});
