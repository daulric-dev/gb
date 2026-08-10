import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { getInitials } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Text } from "@/components/ui/Text";
import { AvatarPresenceDot } from "./PresenceDot";
import {
  conversationTitle,
  otherParticipant,
  previewText,
  timeLabel,
  type ChatConversation,
} from "./types";

export function ConversationRow({
  conversation,
  selfId,
  online,
  onPress,
}: {
  conversation: ChatConversation;
  selfId: string | null;
  online: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const other = otherParticipant(conversation, selfId);
  const title = conversationTitle(conversation, selfId);
  const unread = conversation.unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <View style={styles.row}>
          <View style={styles.avatarWrap}>
            <Avatar
              uri={other?.avatarUrl}
              fallback={getInitials(other?.firstName, other?.lastName)}
              size={44}
            />
            {conversation.type === "direct" ? (
              <AvatarPresenceDot online={online} />
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.topLine}>
              <Text
                weight={unread ? "700" : "600"}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {title}
              </Text>
              <Text variant="muted" size="xs">
                {timeLabel(conversation.lastMessageAt)}
              </Text>
            </View>
            <View style={styles.bottomLine}>
              <Text
                variant="muted"
                size="sm"
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: unread ? colors.foreground : colors.mutedForeground,
                }}
              >
                {previewText(conversation)}
              </Text>
              {unread ? (
                <Badge variant="default">
                  {conversation.unreadCount > 99
                    ? "99+"
                    : String(conversation.unreadCount)}
                </Badge>
              ) : null}
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  avatarWrap: {
    position: "relative",
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
});
