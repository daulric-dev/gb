import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { ArrowLeft, Send } from "lucide-react-native";
import { api, buildUrl } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";
import { PresenceDot } from "@/features/chat/PresenceDot";
import {
  ActionCard,
  SystemBubble,
  TextBubble,
} from "@/features/chat/MessageBubble";
import {
  conversationTitle,
  dedupeMessages,
  otherParticipant,
  type ChatConversation,
  type ChatMessage,
} from "@/features/chat/types";

/** New-message poll cadence for an open thread. */
const MESSAGES_POLL_MS = 5_000;
/** Presence refresh cadence for the header's online indicator. */
const PRESENCE_POLL_MS = 10_000;
/** Page size for the message history request. */
const PAGE_LIMIT = 30;

export default function ChatThreadScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors, radius } = useTheme();
  const { profile } = useAuth();
  const selfId = profile?.id ?? null;

  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();

  const [conversation, setConversation] = useState<ChatConversation | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const markRead = useCallback(() => {
    if (!conversationId) return;
    api(`/chat/conversations/${conversationId}/read`, { method: "POST" }).catch(
      () => {
        /* Non-fatal: the next open reconciles. */
      },
    );
  }, [conversationId]);

  // Load the header (title + participant) by locating this conversation in the
  // list — there is no single-conversation GET endpoint.
  const loadConversation = useCallback(() => {
    return api<ChatConversation[]>("/chat/conversations")
      .then((list) => {
        const found = list.find((c) => c.id === conversationId) ?? null;
        setConversation(found);
      })
      .catch(() => {
        /* Non-fatal. */
      });
  }, [conversationId]);

  const loadMessages = useCallback(() => {
    if (!conversationId) return Promise.resolve();
    return api<ChatMessage[]>(
      `/chat/conversations/${conversationId}/messages?limit=${PAGE_LIMIT}`,
    )
      .then((page) => {
        // API returns newest-first; store oldest-first, merged + deduped.
        const ordered = [...page].reverse();
        setMessages((prev) => {
          const merged = dedupeMessages([...prev, ...ordered]);
          // If a new message arrived from someone else, clear the badge.
          const gotForeign =
            merged.length > prev.length &&
            ordered.some(
              (m) =>
                m.senderId !== selfId &&
                !prev.some((p) => p.id === m.id),
            );
          if (gotForeign) markRead();
          return merged;
        });
      })
      .catch(() => {
        /* Non-fatal: keep what we have. */
      });
  }, [conversationId, selfId, markRead]);

  const loadPresence = useCallback(() => {
    return api<{ online: string[] }>("/chat/presence")
      .then(({ online: ids }) => {
        setConversation((conv) => {
          const other = conv ? otherParticipant(conv, selfId) : null;
          setOnline(!!other && ids.includes(other.userId));
          return conv;
        });
      })
      .catch(() => {
        /* Non-fatal. */
      });
  }, [selfId]);

  // Initial load + mark read on mount.
  useEffect(() => {
    void loadConversation();
    void loadMessages();
    void loadPresence();
    markRead();
  }, [loadConversation, loadMessages, loadPresence, markRead]);

  // Poll for new messages.
  useEffect(() => {
    const timer = setInterval(() => void loadMessages(), MESSAGES_POLL_MS);
    return () => clearInterval(timer);
  }, [loadMessages]);

  // Poll presence for the header indicator.
  useEffect(() => {
    const timer = setInterval(() => void loadPresence(), PRESENCE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadPresence]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    const id = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
    return () => clearTimeout(id);
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !conversationId) return;
    setSending(true);
    setDraft("");
    try {
      const message = await api<ChatMessage>(
        `/chat/conversations/${conversationId}/messages`,
        { method: "POST", body: { body } },
      );
      setMessages((prev) => dedupeMessages([...prev, message]));
    } catch {
      toast.error("Failed to send");
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const act = async (message: ChatMessage, action: "accept" | "dismiss") => {
    setActingId(message.id);
    try {
      const updated = await api<ChatMessage>(
        `/chat/messages/${message.id}/action`,
        { method: "POST", body: { action } },
      );
      setMessages((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m)),
      );
    } catch {
      toast.error("Action failed");
    } finally {
      setActingId(null);
    }
  };

  const onView = async (message: ChatMessage) => {
    if (message.actionState === "pending") {
      await act(message, "accept");
    }
    if (message.type === "file_share") {
      const fileId = message.metadata.fileId;
      if (fileId) {
        Linking.openURL(buildUrl(`/files/${String(fileId)}/content`)).catch(
          () => toast.error("Could not open file"),
        );
      }
    } else if (message.type === "class_invite") {
      const classId = message.metadata.classId;
      if (classId) router.push(`/class/${String(classId)}` as Href);
    }
  };

  const title = conversation
    ? conversationTitle(conversation, selfId)
    : "Conversation";
  const isDirect = conversation?.type === "direct";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <ArrowLeft size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text weight="600" numberOfLines={1}>
            {title}
          </Text>
          {isDirect ? (
            <View style={styles.presenceRow}>
              <PresenceDot online={online} size={8} />
              <Text variant="muted" size="xs">
                {online ? "Online" : "Offline"}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {messages.map((m) => {
          const mine = m.senderId === selfId;
          if (m.type === "text") {
            return <TextBubble key={m.id} message={m} mine={mine} />;
          }
          if (m.type === "system") {
            return <SystemBubble key={m.id} message={m} />;
          }
          return (
            <ActionCard
              key={m.id}
              message={m}
              mine={mine}
              busy={actingId === m.id}
              onView={() => void onView(m)}
              onDismiss={() => void act(m, "dismiss")}
            />
          );
        })}
      </ScrollView>

      <View
        style={[
          styles.inputRow,
          {
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8,
            backgroundColor: colors.background,
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Type a message…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.muted,
              borderRadius: radius.xl,
            },
          ]}
        />
        <Pressable
          onPress={send}
          disabled={sending || !draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.full,
              opacity: sending || !draft.trim() ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Send size={18} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  presenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  messages: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  sendBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
