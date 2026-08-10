import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CustomRole, SchoolMember } from "./types";
import { memberName } from "./types";

export function MemberRolesSheet({
  open,
  member,
  onClose,
  onRolesChanged,
}: {
  open: boolean;
  member: SchoolMember | null;
  onClose: () => void;
  onRolesChanged?: () => void;
}) {
  const toast = useToast();
  const { colors } = useTheme();

  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(
    (membershipId: string) => {
      setLoading(true);
      Promise.all([
        api<CustomRole[]>("/permissions/roles"),
        api<CustomRole[]>(`/permissions/members/${membershipId}/roles`),
      ])
        .then(([all, mine]) => {
          setRoles(all.filter((r) => !r.is_system));
          setAssigned(new Set(mine.map((r) => r.id)));
        })
        .catch(() => toast.error("Failed to load roles"))
        .finally(() => setLoading(false));
    },
    [toast],
  );

  useEffect(() => {
    if (open && member) load(member.id);
  }, [open, member, load]);

  const toggle = async (roleId: string, on: boolean) => {
    if (!member) return;
    setTogglingId(roleId);
    try {
      if (on) {
        await api(`/permissions/members/${member.id}/roles`, {
          method: "POST",
          body: { roleId },
        });
      } else {
        await api(`/permissions/members/${member.id}/roles/${roleId}`, {
          method: "DELETE",
        });
      }
      setAssigned((prev) => {
        const next = new Set(prev);
        if (on) next.add(roleId);
        else next.delete(roleId);
        return next;
      });
      onRolesChanged?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update role");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Roles — ${memberName(member?.user ?? null)}`}
      description="Assign custom roles. Their permissions stack on top of the member's base role."
    >
      {loading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 56, borderRadius: 10 }} />
          ))}
        </View>
      ) : roles.length === 0 ? (
        <Text variant="muted" style={{ textAlign: "center", paddingVertical: 24 }}>
          No custom roles yet. Create one under Roles & Permissions.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {roles.map((role) => (
            <View
              key={role.id}
              style={[
                styles.row,
                { borderColor: colors.border },
              ]}
            >
              <View style={styles.info}>
                <Text weight="600">{role.name}</Text>
                {role.description ? (
                  <Text variant="muted" style={{ fontSize: 12 }} numberOfLines={2}>
                    {role.description}
                  </Text>
                ) : null}
              </View>
              <Switch
                value={assigned.has(role.id)}
                disabled={togglingId === role.id}
                onValueChange={(v) => toggle(role.id, v)}
              />
            </View>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  info: {
    flex: 1,
    gap: 2,
  },
});
