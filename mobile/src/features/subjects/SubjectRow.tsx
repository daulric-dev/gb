import { Pressable, StyleSheet, View } from "react-native";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import type { Subject } from "./types";

/** A single subject row: name, code badge, graded indicator, reorder + actions. */
export function SubjectRow({
  subject,
  canReorder,
  canEdit,
  canDelete,
  isFirst,
  isLast,
  reordering,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  subject: Subject;
  canReorder: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  reordering: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Card>
      <CardContent style={styles.row}>
        {canReorder ? (
          <View style={styles.reorder}>
            <IconBtn onPress={onMoveUp} disabled={isFirst || reordering}>
              <ChevronUp
                size={18}
                color={
                  isFirst || reordering ? colors.border : colors.mutedForeground
                }
              />
            </IconBtn>
            <IconBtn onPress={onMoveDown} disabled={isLast || reordering}>
              <ChevronDown
                size={18}
                color={
                  isLast || reordering ? colors.border : colors.mutedForeground
                }
              />
            </IconBtn>
          </View>
        ) : null}

        <View style={styles.info}>
          <Text weight="600" numberOfLines={1}>
            {subject.name}
          </Text>
          <View style={styles.meta}>
            {subject.code ? (
              <Badge variant="outline">{subject.code}</Badge>
            ) : null}
            {subject.is_graded ? (
              <Badge variant="default">Graded</Badge>
            ) : (
              <Badge variant="secondary">Not Graded</Badge>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          {canEdit ? (
            <IconBtn onPress={onEdit}>
              <Pencil size={18} color={colors.mutedForeground} />
            </IconBtn>
          ) : null}
          {canDelete ? (
            <IconBtn onPress={onDelete}>
              <Trash2 size={18} color={colors.destructive} />
            </IconBtn>
          ) : null}
        </View>
      </CardContent>
    </Card>
  );
}

function IconBtn({
  children,
  onPress,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconBtn,
        { opacity: pressed && !disabled ? 0.6 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  reorder: {
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 6,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconBtn: {
    padding: 6,
  },
});
