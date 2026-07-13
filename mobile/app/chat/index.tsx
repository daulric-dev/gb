import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { MessageSquare, Plus } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConversationRow } from "@/features/chat/ConversationRow";
import { NewChatSheet } from "@/features/chat/NewChatSheet";
import {
  otherParticipant,
  type ChatConversation,
} from "@/features/chat/types";

/** How often the list re-fetches conversations + presence while mounted. */
const LIST_POLL_MS = 10_000;

export default function ChatListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile } = useAuth();
  const selfId = profile?.id ?? null;

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const fetchConversations = useCallback(() => {
    return api<ChatConversation[]>("/chat/conversations")
      .then((data) => setConversations(data))
      .catch(() => {
        /* Non-fatal: keep whatever we had. */
      });
  }, []);

  const fetchPresence = useCallback(() => {
    return api<{ online: string[] }>("/chat/presence")
      .then(({ online: ids }) => setOnline(new Set(ids)))
      .catch(() => {
        /* Non-fatal: keep the last known set. */
      });
  }, []);

  // Initial load.
  useEffect(() => {
    Promise.all([fetchConversations(), fetchPresence()]).finally(() =>
      setLoading(false),
    );
  }, [fetchConversations, fetchPresence]);

  // Poll while mounted; clear on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(() => {
      void fetchConversations();
      void fetchPresence();
    }, LIST_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchConversations, fetchPresence]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([fetchConversations(), fetchPresence()]).finally(() =>
      setRefreshing(false),
    );
  }, [fetchConversations, fetchPresence]);

  const openConversation = (id: string) => {
    router.push(`/chat/${id}` as Href);
  };

  return (
    <Screen
      title="Messages"
      description="Chat with anyone at your school"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={
        <Button
          size="sm"
          onPress={() => setNewChatOpen(true)}
          icon={<Plus size={16} color={colors.primaryForeground} />}
        >
          New
        </Button>
      }
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 72, borderRadius: 14 }} />
          ))}
        </View>
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Start one with the New button."
        />
      ) : (
        <View style={{ gap: 10 }}>
          {conversations.map((conv) => {
            const other = otherParticipant(conv, selfId);
            return (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                selfId={selfId}
                online={!!other && online.has(other.userId)}
                onPress={() => openConversation(conv.id)}
              />
            );
          })}
        </View>
      )}

      <NewChatSheet
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onlineUsers={online}
        onStarted={(conv) => {
          setNewChatOpen(false);
          // Reflect the new conversation immediately, then open it.
          setConversations((prev) =>
            prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
          );
          openConversation(conv.id);
        }}
      />
    </Screen>
  );
}
