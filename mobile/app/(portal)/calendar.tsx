import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  Megaphone,
  PenLine,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import {
  AGENDA_DAYS,
  dayHeading,
  groupByDay,
  noticeHref,
  type CourseNotification,
  type PortalCalendarItem,
} from "@/lib/calendar";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function AgendaRow({ item }: { item: PortalCalendarItem }) {
  const router = useRouter();
  const { colors } = useTheme();
  const Icon =
    item.kind === "quiz" ? ClipboardList : item.kind === "offline" ? PenLine : FileText;
  const s = item.submission;

  return (
    <Pressable
      onPress={() => router.push(`/work/${item.activityId}` as Href)}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon color={colors.mutedForeground} size={18} />
      <View style={styles.rowBody}>
        <Text weight="500" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="muted" size="xs" numberOfLines={1}>
          {`${item.courseName} · ${timeLabel(item.dueAt)}`}
        </Text>
      </View>
      {s?.excused ? (
        <Badge variant="outline">Excused</Badge>
      ) : s?.status === "graded" ? (
        <Badge>
          {s.score ?? 0}/{item.points}
        </Badge>
      ) : s?.status === "submitted" ? (
        <Badge variant="secondary">Handed in</Badge>
      ) : item.status === "closed" ? (
        <Badge variant="outline">Closed</Badge>
      ) : null}
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  );
}

function NoticeRow({
  notice,
  onOpen,
}: {
  notice: CourseNotification;
  onOpen: (n: CourseNotification) => void;
}) {
  const { colors } = useTheme();
  const Icon = notice.kind === "announcement" ? Megaphone : FileText;
  return (
    <Pressable
      onPress={() => onOpen(notice)}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon color={colors.primary} size={18} />
      <View style={styles.rowBody}>
        <Text weight="500" numberOfLines={2}>
          {notice.title}
        </Text>
        <Text variant="muted" size="xs" numberOfLines={1}>
          {[notice.courseName, notice.body].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  );
}

/**
 * What is coming up: unread notices about new work and announcements, then
 * every due date in the next two months, day by day.
 */
export default function PortalCalendarScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [items, setItems] = useState<PortalCalendarItem[]>([]);
  const [notices, setNotices] = useState<CourseNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + AGENDA_DAYS * 86_400_000);
    const qs = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    return Promise.all([
      api<PortalCalendarItem[]>(`/portal/me/calendar?${qs}`)
        .then(setItems)
        .catch(() => setItems([])),
      api<CourseNotification[]>("/portal/me/notifications?unread=true&limit=10")
        .then(setNotices)
        .catch(() => setNotices([])),
    ]);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const openNotice = useCallback(
    (n: CourseNotification) => {
      setNotices((list) => list.filter((x) => x.id !== n.id));
      void api("/portal/me/notifications/read", {
        method: "POST",
        body: { ids: [n.id] },
      }).catch(() => {});
      const href = noticeHref(n);
      if (href) router.push(href as Href);
    },
    [router],
  );

  const days = groupByDay(items);

  return (
    <Screen
      title="Calendar"
      description="What's due across your courses"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 120 }} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {notices.length > 0 && (
            <Card>
              <CardHeader>
                <View style={styles.headerRow}>
                  <Bell size={16} color={colors.mutedForeground} />
                  <CardTitle>New</CardTitle>
                </View>
              </CardHeader>
              <CardContent style={{ gap: 8 }}>
                {notices.map((n) => (
                  <NoticeRow key={n.id} notice={n} onOpen={openNotice} />
                ))}
              </CardContent>
            </Card>
          )}

          {days.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nothing due soon"
              description="Due dates from your courses for the next two months appear here."
            />
          ) : (
            days.map((day) => (
              <Card key={day.key}>
                <CardHeader>
                  <CardTitle>{dayHeading(day.date)}</CardTitle>
                </CardHeader>
                <CardContent style={{ gap: 8 }}>
                  {day.items.map((item) => (
                    <AgendaRow key={item.activityId} item={item} />
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowBody: { flex: 1, gap: 2 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
