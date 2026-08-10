import { Pressable, StyleSheet, View } from "react-native";
import { File, Pencil, Share2, Trash2 } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { type FileItem, formatBytes } from "./types";

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

/** A file card row: icon, name, size/date, status, and owner action icons. */
export function FileRow({
  file,
  isOwner,
  onPress,
  onShare,
  onRename,
  onDelete,
}: {
  file: FileItem;
  isOwner: boolean;
  onPress: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const ready = file.status === "ready";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <CardContent style={styles.row}>
          <File size={20} color={colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text weight="600" numberOfLines={1}>
              {file.name}
            </Text>
            <View style={styles.metaRow}>
              <Text variant="muted" style={{ fontSize: 12 }}>
                {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
              </Text>
              {!ready ? (
                <Badge
                  variant="outline"
                  color={
                    file.status === "infected" || file.status === "failed"
                      ? colors.destructive
                      : undefined
                  }
                >
                  {file.status === "infected"
                    ? "Quarantined"
                    : file.status === "failed"
                      ? "Failed"
                      : "Processing…"}
                </Badge>
              ) : null}
            </View>
          </View>
          {isOwner ? (
            <View style={styles.actions}>
              <IconButton onPress={onShare}>
                <Share2 size={18} color={colors.mutedForeground} />
              </IconButton>
              <IconButton onPress={onRename}>
                <Pencil size={18} color={colors.mutedForeground} />
              </IconButton>
              <IconButton onPress={onDelete}>
                <Trash2 size={18} color={colors.destructive} />
              </IconButton>
            </View>
          ) : null}
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    flexWrap: "wrap",
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
