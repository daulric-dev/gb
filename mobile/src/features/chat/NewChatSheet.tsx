import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { api } from "@/lib/api";
import { getInitials } from "@/lib/utils";
import { useTheme } from "@/theme/ThemeProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Text } from "@/components/ui/Text";
import { AvatarPresenceDot } from "./PresenceDot";
import {
  participantName,
  type ChatConversation,
  type ChatParticipant,
} from "./types";

/**
 * Mobile analogue of the web `NewChatDialog`. Lists people the caller can
 * message (`GET /chat/users`) and starts (or reuses) a DM via
 * `POST /chat/conversations`.
 */
export function NewChatSheet({
  open,
  onClose,
  onlineUsers,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onlineUsers: Set<string>;
  onStarted: (conversation: ChatConversation) => void;
}) {
  const { colors } = useTheme();
  const [users, setUsers] = useState<ChatParticipant[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLoading(true);
    api<ChatParticipant[]>("/chat/users")
      .then((u) => setUsers(u))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => participantName(u).toLowerCase().includes(q));
  }, [users, query]);

  const start = async (user: ChatParticipant) => {
    if (busy) return;
    setBusy(true);
    try {
      const conv = await api<ChatConversation>("/chat/conversations", {
        method: "POST",
        body: { userId: user.userId },
      });
      onStarted(conv);
    } catch {
      /* Non-fatal: caller can retry. */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New message"
      description="Pick someone in your school to start a conversation."
    >
      <Input
        placeholder="Search people…"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : filtered.length === 0 ? (
        <Text variant="muted" style={styles.center}>
          No one to message.
        </Text>
      ) : (
        <View style={{ gap: 4 }}>
          {filtered.map((u) => (
            <Pressable
              key={u.userId}
              disabled={busy}
              onPress={() => start(u)}
              style={({ pressed }) => [
                styles.userRow,
                { opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              <View style={styles.avatarWrap}>
                <Avatar
                  uri={u.avatarUrl}
                  fallback={getInitials(u.firstName, u.lastName)}
                  size={36}
                />
                <AvatarPresenceDot online={onlineUsers.has(u.userId)} />
              </View>
              <Text numberOfLines={1} style={{ flex: 1 }}>
                {participantName(u)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: 24,
    alignItems: "center",
    textAlign: "center",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  avatarWrap: {
    position: "relative",
  },
});
