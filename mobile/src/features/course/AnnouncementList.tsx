import { Pressable, StyleSheet, View } from "react-native";
import { Megaphone, Pencil, Trash2 } from "lucide-react-native";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { Markdown } from "@/components/ui/Markdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import {
  announcementAuthor,
  initials,
  timeAgo,
  type CourseAnnouncement,
} from "@/lib/course";

/**
 * A course's announcements, newest first. Staff pass `canChange` with the
 * edit and delete handlers; students only read.
 */
export function AnnouncementList({
  announcements,
  canChange,
  onEdit,
  onDelete,
  emptyHint,
}: {
  announcements: CourseAnnouncement[];
  canChange?: (a: CourseAnnouncement) => boolean;
  onEdit?: (a: CourseAnnouncement) => void;
  onDelete?: (a: CourseAnnouncement) => void;
  emptyHint?: string;
}) {
  const { colors } = useTheme();

  if (announcements.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No announcements"
        description={emptyHint ?? "Course news shows up here."}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {announcements.map((a) => {
        const editable = canChange?.(a) ?? false;
        return (
          <Card key={a.id}>
            <CardContent style={{ gap: 10 }}>
              <View style={styles.head}>
                <Avatar
                  uri={a.author?.avatar_url}
                  fallback={initials(a.author?.first_name, a.author?.last_name)}
                  size={32}
                />
                <View style={{ flex: 1 }}>
                  <Text weight="600">{a.title}</Text>
                  <Text variant="muted" size="xs">
                    {announcementAuthor(a)} · {timeAgo(a.created_at)}
                    {a.updated_at !== a.created_at ? " · edited" : ""}
                  </Text>
                </View>
                {editable && onEdit ? (
                  <Pressable hitSlop={8} onPress={() => onEdit(a)}>
                    <Pencil color={colors.mutedForeground} size={18} />
                  </Pressable>
                ) : null}
                {editable && onDelete ? (
                  <Pressable hitSlop={8} onPress={() => onDelete(a)}>
                    <Trash2 color={colors.destructive} size={18} />
                  </Pressable>
                ) : null}
              </View>
              <Markdown>{a.body}</Markdown>
            </CardContent>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
});
