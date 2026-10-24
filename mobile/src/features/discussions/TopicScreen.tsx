import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  EyeOff,
  MessageSquareReply,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Markdown } from "@/components/ui/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { TextArea } from "@/components/ui/TextArea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import {
  authorName,
  errorMessage,
  initials,
  timeAgo,
  type DiscussionAuthor,
  type DiscussionReply,
  type DiscussionTopic,
} from "@/lib/course";
import { TopicEditorSheet } from "./TopicEditorSheet";

type Composer =
  | { mode: "reply"; parent: DiscussionReply | null }
  | { mode: "edit"; reply: DiscussionReply };

function Byline({
  author,
  createdAt,
  editedAt,
}: {
  author: DiscussionAuthor | null;
  createdAt: string;
  editedAt: string | null;
}) {
  return (
    <View style={styles.byline}>
      <Avatar
        uri={author?.avatarUrl}
        fallback={initials(author?.firstName, author?.lastName)}
        size={28}
      />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text weight="600" size="sm">
            {authorName(author)}
          </Text>
          {author?.isStaff && <Badge variant="secondary">Staff</Badge>}
        </View>
        <Text variant="muted" size="xs">
          {timeAgo(createdAt)}
          {editedAt ? " · edited" : ""}
        </Text>
      </View>
    </View>
  );
}

/**
 * One discussion topic with its replies, for students and staff alike: the
 * API decides what the caller may do (`canReply`, `canEdit` on each post),
 * so the screen only follows those flags. Replies are one level deep.
 */
export function TopicScreen({
  apiBase,
  topicId,
  isStaff,
}: {
  apiBase: string;
  topicId: string;
  isStaff: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const path = `${apiBase}/${topicId}`;

  const [topic, setTopic] = useState<DiscussionTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "topic" } | { kind: "reply"; reply: DiscussionReply } | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const data = await api<DiscussionTopic>(path).catch(() => null);
    setTopic(data);
  }, [path]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  function openComposer(next: Composer) {
    setDraft(next.mode === "edit" ? next.reply.body : "");
    setComposer(next);
  }

  async function submit() {
    if (!composer || !draft.trim()) return;
    setPosting(true);
    try {
      if (composer.mode === "edit") {
        await api(`${path}/replies/${composer.reply.id}`, {
          method: "PATCH",
          body: { body: draft.trim() },
        });
        toast.success("Reply updated");
      } else {
        await api(`${path}/replies`, {
          method: "POST",
          body: {
            body: draft.trim(),
            ...(composer.parent ? { parentId: composer.parent.id } : {}),
          },
        });
        toast.success("Reply posted");
      }
      setComposer(null);
      setDraft("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to post"));
    } finally {
      setPosting(false);
    }
  }

  async function confirmDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.kind === "topic") {
        await api(path, { method: "DELETE" });
        toast.success("Topic deleted");
        setConfirm(null);
        router.back();
        return;
      }
      await api(`${path}/replies/${confirm.reply.id}`, { method: "DELETE" });
      toast.success("Reply deleted");
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete"));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Screen title="Discussion" onBack={() => router.back()}>
        <Skeleton style={{ height: 160 }} />
        <Skeleton style={{ height: 220 }} />
      </Screen>
    );
  }

  if (!topic) {
    return (
      <Screen
        title="Discussion"
        description="This topic could not be loaded"
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const renderReply = (r: DiscussionReply, nested: boolean) => (
    <View
      key={r.id}
      style={[
        styles.reply,
        nested && { marginLeft: 16, borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 12 },
      ]}
    >
      {r.isDeleted ? (
        <Text variant="muted" size="sm" style={{ fontStyle: "italic" }}>
          This reply was deleted.
        </Text>
      ) : (
        <>
          <View style={styles.replyHead}>
            <View style={{ flex: 1 }}>
              <Byline
                author={r.author}
                createdAt={r.createdAt}
                editedAt={r.editedAt}
              />
            </View>
            {r.isNew && <Badge variant="default">New</Badge>}
          </View>
          <Markdown>{r.body}</Markdown>
          <View style={styles.actions}>
            {topic.canReply && (
              <Pressable
                hitSlop={6}
                onPress={() => openComposer({ mode: "reply", parent: r })}
                style={styles.action}
              >
                <MessageSquareReply color={colors.mutedForeground} size={14} />
                <Text variant="muted" size="xs">
                  Reply
                </Text>
              </Pressable>
            )}
            {r.canEdit && (
              <>
                <Pressable
                  hitSlop={6}
                  onPress={() => openComposer({ mode: "edit", reply: r })}
                  style={styles.action}
                >
                  <Pencil color={colors.mutedForeground} size={14} />
                  <Text variant="muted" size="xs">
                    Edit
                  </Text>
                </Pressable>
                <Pressable
                  hitSlop={6}
                  onPress={() => setConfirm({ kind: "reply", reply: r })}
                  style={styles.action}
                >
                  <Trash2 color={colors.destructive} size={14} />
                  <Text size="xs" style={{ color: colors.destructive }}>
                    Delete
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
      {!nested && r.replies.map((child) => renderReply(child, true))}
    </View>
  );

  return (
    <Screen
      title={topic.title}
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Card>
        <CardContent style={{ gap: 12 }}>
          <View style={styles.badges}>
            {topic.isPinned && (
              <View style={styles.action}>
                <Pin color={colors.primary} size={14} />
                <Text size="xs" weight="600">
                  Pinned
                </Text>
              </View>
            )}
            {topic.isLocked && <Badge variant="outline">Locked</Badge>}
            {!topic.isPublished && <Badge variant="secondary">Draft</Badge>}
            {topic.requireInitialPost && (
              <Badge variant="outline">Post first</Badge>
            )}
          </View>
          <View style={styles.replyHead}>
            <View style={{ flex: 1 }}>
              <Byline
                author={topic.author}
                createdAt={topic.createdAt}
                editedAt={topic.editedAt}
              />
            </View>
            {topic.canEdit && (
              <>
                <Pressable hitSlop={8} onPress={() => setEditingTopic(true)}>
                  <Pencil color={colors.mutedForeground} size={18} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => setConfirm({ kind: "topic" })}
                >
                  <Trash2 color={colors.destructive} size={18} />
                </Pressable>
              </>
            )}
          </View>
          <Markdown>{topic.body}</Markdown>
        </CardContent>
      </Card>

      {topic.canReply ? (
        <Button onPress={() => openComposer({ mode: "reply", parent: null })}>
          Post a reply
        </Button>
      ) : (
        <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
          {topic.isLocked
            ? "This topic is locked."
            : "This course is read-only."}
        </Text>
      )}

      <View style={{ gap: 8 }}>
        <Text variant="label" style={{ color: colors.mutedForeground }}>
          {topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}
        </Text>
        {topic.mustPostFirst && (
          <Card>
            <CardContent style={styles.notice}>
              <EyeOff color={colors.mutedForeground} size={18} />
              <Text variant="muted" size="sm" style={{ flex: 1 }}>
                Post your reply first; you will see your classmates&apos;
                replies after.
              </Text>
            </CardContent>
          </Card>
        )}
        {topic.replies.length > 0 && (
          <Card>
            <CardContent style={{ gap: 16 }}>
              {topic.replies.map((r) => renderReply(r, false))}
            </CardContent>
          </Card>
        )}
      </View>

      <Sheet
        open={composer !== null}
        onClose={() => setComposer(null)}
        title={
          composer?.mode === "edit"
            ? "Edit reply"
            : composer?.parent
              ? `Reply to ${authorName(composer.parent.author)}`
              : "Reply"
        }
      >
        <View style={{ gap: 12 }}>
          <TextArea
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a reply..."
            numberOfLines={6}
            maxLength={10000}
            autoFocus
          />
          <Button onPress={submit} loading={posting} disabled={!draft.trim()}>
            {composer?.mode === "edit" ? "Save" : "Post reply"}
          </Button>
        </View>
      </Sheet>

      <TopicEditorSheet
        open={editingTopic}
        apiBase={apiBase}
        isStaff={isStaff}
        topic={topic}
        onClose={() => setEditingTopic(false)}
        onSaved={() => {
          setEditingTopic(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "topic" ? "Delete this topic?" : "Delete this reply?"}
        message={
          confirm?.kind === "topic"
            ? "The topic and every reply in it are removed."
            : "If others answered it, a placeholder stays in its place."
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirm(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  byline: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  reply: { gap: 8 },
  replyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", gap: 16 },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
});
