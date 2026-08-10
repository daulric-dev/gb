import { Pressable, StyleSheet, View } from "react-native";
import { Shield, Trash2 } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { getInitials, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import type { MemberRole, SchoolMember } from "./types";
import { memberName } from "./types";

const ROLE_META: Record<
  MemberRole,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  admin: { label: "Admins", variant: "default" },
  teacher: { label: "Teachers", variant: "secondary" },
  member: { label: "Members", variant: "outline" },
};

export function RoleSection({
  role,
  members,
  removingId,
  currentUserId,
  onRemove,
  onManageRoles,
}: {
  role: MemberRole;
  members: SchoolMember[];
  removingId?: string | null;
  currentUserId?: string;
  onRemove?: (member: SchoolMember) => void;
  onManageRoles?: (member: SchoolMember) => void;
}) {
  const { colors } = useTheme();
  const meta = ROLE_META[role];

  if (members.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.heading}>
        <Text variant="subtitle">{meta.label}</Text>
        <Badge variant={meta.variant}>{String(members.length)}</Badge>
      </View>
      <Card>
        <CardContent style={styles.list}>
          {members.map((m, i) => {
            const isSelf = m.user?.id === currentUserId;
            const removing = removingId === m.id;
            return (
              <View
                key={m.id}
                style={[
                  styles.row,
                  i > 0
                    ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }
                    : null,
                ]}
              >
                <Avatar
                  size={40}
                  uri={m.user?.avatar_url}
                  fallback={getInitials(m.user?.first_name, m.user?.last_name)}
                />
                <View style={styles.info}>
                  <Text weight="600" numberOfLines={1}>
                    {memberName(m.user)}
                  </Text>
                  <Text variant="muted" style={{ fontSize: 12 }}>
                    Joined {formatDate(m.created_at)}
                  </Text>
                  {m.roles.length > 0 ? (
                    <View style={styles.roleTags}>
                      {m.roles.map((r) => (
                        <Badge key={r.id} variant="secondary">
                          {r.name}
                        </Badge>
                      ))}
                    </View>
                  ) : null}
                </View>
                {onManageRoles ? (
                  <Pressable
                    hitSlop={6}
                    onPress={() => onManageRoles(m)}
                    style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Shield size={18} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
                {onRemove && !isSelf ? (
                  <Pressable
                    hitSlop={6}
                    disabled={removing}
                    onPress={() => onRemove(m)}
                    style={({ pressed }) => [
                      styles.iconBtn,
                      { opacity: removing ? 0.4 : pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Trash2 size={18} color={colors.destructive} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </CardContent>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  list: {
    padding: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  roleTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  iconBtn: {
    padding: 6,
  },
});
