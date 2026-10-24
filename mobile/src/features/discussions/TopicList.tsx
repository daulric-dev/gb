import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  ChevronRight,
  MessagesSquare,
  Pin,
  Plus,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { authorName, timeAgo, type DiscussionList } from "@/lib/course";
import { TopicEditorSheet } from "./TopicEditorSheet";

/**
 * A course's discussion topics, pinned first (the API orders them). Starting
 * a topic is offered when the API says the caller may (`canCreateTopics`).
 */
export function TopicList({
  apiBase,
  isStaff,
  refreshKey = 0,
  onOpen,
}: {
  /** `/portal/me/courses/:id/discussions` or `/courses/:id/discussions`. */
  apiBase: string;
  isStaff: boolean;
  refreshKey?: number;
  onOpen: (topicId: string) => void;
}) {
  const { colors } = useTheme();
  const [data, setData] = useState<DiscussionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<DiscussionList>(apiBase));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [apiBase]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  if (loading) return <Skeleton style={{ height: 160 }} />;
  if (failed || !data) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="Discussions could not be loaded"
        description="Pull down to try again."
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {data.canCreateTopics && (
        <Button
          variant="outline"
          icon={<Plus color={colors.foreground} size={16} />}
          onPress={() => setCreating(true)}
        >
          New topic
        </Button>
      )}

      {data.topics.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No discussions yet"
          description={
            data.canCreateTopics
              ? "Start the first topic."
              : "Topics your teacher opens show up here."
          }
        />
      ) : (
        data.topics.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => onOpen(t.id)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Card>
              <CardContent style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    {t.isPinned && <Pin color={colors.primary} size={14} />}
                    <Text weight={t.isRead ? "500" : "700"} style={{ flex: 1 }}>
                      {t.title}
                    </Text>
                  </View>
                  <Text variant="muted" size="xs">
                    {authorName(t.author)} ·{" "}
                    {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                    {t.lastReplyAt ? ` · last ${timeAgo(t.lastReplyAt)}` : ""}
                  </Text>
                  <View style={styles.badges}>
                    {t.unreadCount > 0 && (
                      <Badge variant="default">{`${t.unreadCount} new`}</Badge>
                    )}
                    {t.isLocked && (
                      <Badge variant="outline">Locked</Badge>
                    )}
                    {t.requireInitialPost && (
                      <Badge variant="outline">Post first</Badge>
                    )}
                    {!t.isPublished && <Badge variant="secondary">Draft</Badge>}
                  </View>
                </View>
                <ChevronRight color={colors.mutedForeground} size={16} />
              </CardContent>
            </Card>
          </Pressable>
        ))
      )}

      <TopicEditorSheet
        open={creating}
        apiBase={apiBase}
        isStaff={isStaff}
        onClose={() => setCreating(false)}
        onSaved={(id) => {
          setCreating(false);
          void load();
          if (id) onOpen(id);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
