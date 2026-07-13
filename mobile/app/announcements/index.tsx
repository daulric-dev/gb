import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/lib/utils";
import { Screen } from "@/components/layout/Screen";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AnnouncementForm } from "@/features/announcements/AnnouncementForm";
import { ReaderAvatars } from "@/features/announcements/ReaderAvatars";
import type { Announcement } from "@/features/announcements/types";

function authorName(a: Announcement): string {
  const name = `${a.author?.first_name ?? ""} ${a.author?.last_name ?? ""}`.trim();
  return name || "Staff";
}

export default function AnnouncementsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { can, isAdmin } = usePermissions();
  const { profile } = useAuth();
  const myId = profile?.id;

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAnnouncements = useCallback(() => {
    return api<Announcement[]>("/announcements")
      .then((data) => setAnnouncements(data))
      .catch(() => toast.error("Failed to load announcements"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchAnnouncements();
    // Viewing the board marks everything up to now as read (clears the badge).
    api("/announcements/mark-read", { method: "POST" }).catch(() => {
      /* Non-fatal: leave the badge as-is if the mark fails. */
    });
  }, [fetchAnnouncements]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAnnouncements().finally(() => setRefreshing(false));
  }, [fetchAnnouncements]);

  const canManage = (a: Announcement) =>
    isAdmin || (!!myId && a.author_user_profile_id === myId);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/announcements/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Announcement deleted");
      setConfirmDelete(null);
      fetchAnnouncements();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const canCreate = can("announcement", "create");

  return (
    <Screen
      title="Announcements"
      description="Notices for all staff in your school"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={
        canCreate ? (
          <Button
            size="sm"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            icon={<Plus size={16} color={colors.primaryForeground} />}
          >
            New
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 120, borderRadius: 16 }} />
          ))}
        </View>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="Notices posted for your school will appear here."
        />
      ) : (
        <View style={{ gap: 16 }}>
          {announcements.map((a) => {
            const manageable = canManage(a);
            return (
              <Card key={a.id}>
                <CardHeader style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <CardTitle>{a.title}</CardTitle>
                    <Text variant="muted" style={{ marginTop: 2 }}>
                      {authorName(a)} · {formatDate(a.created_at)}
                    </Text>
                  </View>
                  {manageable ? (
                    <View style={styles.actions}>
                      {can("announcement", "update") ? (
                        <IconBtn onPress={() => {
                          setEditing(a);
                          setFormOpen(true);
                        }}>
                          <Pencil size={18} color={colors.mutedForeground} />
                        </IconBtn>
                      ) : null}
                      {can("announcement", "delete") ? (
                        <IconBtn onPress={() => setConfirmDelete(a)}>
                          <Trash2 size={18} color={colors.destructive} />
                        </IconBtn>
                      ) : null}
                    </View>
                  ) : null}
                </CardHeader>
                <CardContent style={styles.cardContent}>
                  {a.body ? <Text>{a.body}</Text> : null}
                  <ReaderAvatars readers={a.readers ?? []} />
                </CardContent>
              </Card>
            );
          })}
        </View>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Announcement" : "New Announcement"}
        description={
          editing
            ? "Update this notice"
            : "Post a notice visible to everyone in your school"
        }
      >
        <AnnouncementForm
          announcement={editing ?? undefined}
          onSuccess={() => {
            setFormOpen(false);
            fetchAnnouncements();
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete announcement?"
        message={`"${confirmDelete?.title}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
  );
}

function IconBtn({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 4,
  },
  cardContent: {
    paddingTop: 0,
    gap: 16,
  },
  iconBtn: {
    padding: 6,
  },
});
