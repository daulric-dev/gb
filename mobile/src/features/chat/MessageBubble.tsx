import { StyleSheet, View } from "react-native";
import { Check, FileText, GraduationCap, X } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { messageTime, type ChatMessage } from "./types";

/** A plain text bubble: mine right-aligned/primary, others left/muted. */
export function TextBubble({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  const { colors, radius } = useTheme();
  const deleted = !!message.deletedAt;
  const bg = mine ? colors.primary : colors.muted;
  const fg = mine ? colors.primaryForeground : colors.foreground;

  return (
    <View style={[styles.rowWrap, mine ? styles.alignEnd : styles.alignStart]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: bg, borderRadius: radius.xl },
        ]}
      >
        <Text
          style={{
            color: fg,
            fontStyle: deleted ? "italic" : "normal",
            opacity: deleted ? 0.7 : 1,
          }}
        >
          {deleted ? "Message deleted" : message.body}
        </Text>
        <Text
          size="xs"
          style={{
            color: fg,
            opacity: 0.7,
            marginTop: 2,
            textAlign: "right",
          }}
        >
          {message.editedAt && !deleted ? "edited · " : ""}
          {messageTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

/** A centered, muted system notice. */
export function SystemBubble({ message }: { message: ChatMessage }) {
  return (
    <View style={styles.systemWrap}>
      <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
        {message.body}
      </Text>
    </View>
  );
}

/** A file_share / class_invite card with accept & dismiss actions. */
export function ActionCard({
  message,
  mine,
  busy,
  onView,
  onDismiss,
}: {
  message: ChatMessage;
  mine: boolean;
  busy: boolean;
  onView: () => void;
  onDismiss: () => void;
}) {
  const { colors, radius } = useTheme();
  const isFile = message.type === "file_share";
  const Icon = isFile ? FileText : GraduationCap;
  const dismissed = message.actionState === "dismissed";
  const accepted = message.actionState === "accepted";
  const pending = message.actionState === "pending";

  const title = isFile
    ? String(message.metadata.fileName ?? "a file")
    : String(message.metadata.className ?? "a class");

  return (
    <View style={styles.systemWrap}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.cardRow}>
          <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
            <Icon size={16} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text size="sm">
              <Text size="sm" weight="600">
                {mine ? "You" : "They"}
              </Text>{" "}
              {message.body}
            </Text>
            <Text variant="muted" size="xs" numberOfLines={1}>
              {title}
            </Text>

            {mine ? (
              <Text variant="muted" size="xs" style={{ marginTop: 8 }}>
                {accepted
                  ? isFile
                    ? "Opened"
                    : "Viewed"
                  : dismissed
                    ? "Dismissed"
                    : "Waiting for a response"}
              </Text>
            ) : (
              <View style={styles.actions}>
                <Button
                  size="sm"
                  onPress={onView}
                  loading={busy}
                  icon={<Check size={14} color={colors.primaryForeground} />}
                >
                  {pending
                    ? isFile
                      ? "Accept & view file"
                      : "Accept & view class"
                    : isFile
                      ? "View file"
                      : "View class"}
                </Button>
                {pending ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={onDismiss}
                    disabled={busy}
                    icon={<X size={14} color={colors.foreground} />}
                  >
                    Dismiss
                  </Button>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    flexDirection: "row",
  },
  alignEnd: {
    justifyContent: "flex-end",
  },
  alignStart: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  systemWrap: {
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
});
