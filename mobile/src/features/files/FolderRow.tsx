import { Pressable, StyleSheet, View } from "react-native";
import {
  ChevronRight,
  FolderClosed,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import type { FolderItem } from "./types";

function IconButton({
  onPress,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** A folder card row: opens on tap; system folders can't be renamed/deleted. */
export function FolderRow({
  folder,
  canManage,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderItem;
  canManage: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <CardContent style={styles.row}>
          <FolderClosed size={20} color={colors.mutedForeground} />
          <Text weight="600" numberOfLines={1} style={{ flex: 1 }}>
            {folder.name}
          </Text>
          {folder.isSystem ? (
            <Lock size={14} color={colors.mutedForeground} />
          ) : null}
          {canManage && !folder.isSystem ? (
            <View style={styles.actions}>
              <IconButton onPress={onRename}>
                <Pencil size={18} color={colors.mutedForeground} />
              </IconButton>
              <IconButton onPress={onDelete}>
                <Trash2 size={18} color={colors.destructive} />
              </IconButton>
            </View>
          ) : (
            <ChevronRight size={18} color={colors.mutedForeground} />
          )}
        </CardContent>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
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
