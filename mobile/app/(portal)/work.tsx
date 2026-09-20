import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  NotebookPen,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { dueLabel, isOutstanding, type PortalWorkItem } from "@/lib/work";

function WorkRow({ item }: { item: PortalWorkItem }) {
  const router = useRouter();
  const { colors } = useTheme();
  const Icon = item.kind === "quiz" ? ClipboardList : FileText;

  const marked = item.submission?.status === "graded";
  const handedIn = !!item.submission && item.submission.status !== "draft";

  return (
    <Pressable
      onPress={() => router.push(`/work/${item.id}`)}
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
        <Text variant="muted" size="xs">
          {[item.subject?.name, `${item.points} points`, dueLabel(item.dueAt)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {marked ? (
        <Badge>
          {item.submission?.score ?? 0}/{item.points}
        </Badge>
      ) : handedIn ? (
        <Badge variant="secondary">Handed in</Badge>
      ) : null}
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  );
}

/**
 * Work set for the student's classes.
 *
 * Outstanding work sorts first: the question this screen answers is "what do I
 * still have to do", and everything else is history.
 */
export default function PortalWorkScreen() {
  const [items, setItems] = useState<PortalWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<PortalWorkItem[]>("/portal/me/activities")
        .then(setItems)
        .catch(() => setItems([])),
    [],
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const todo = items.filter(isOutstanding);
  const done = items.filter((i) => !isOutstanding(i));

  return (
    <Screen
      title="Work"
      description="Quizzes and assignments for your classes"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="Nothing set right now"
          description="Quizzes and assignments appear here when your teachers publish them."
        />
      ) : (
        <View style={{ gap: 12 }}>
          {todo.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>To do</CardTitle>
              </CardHeader>
              <CardContent style={{ gap: 8 }}>
                {todo.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </CardContent>
            </Card>
          )}

          {done.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Done</CardTitle>
              </CardHeader>
              <CardContent style={{ gap: 8 }}>
                {done.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </CardContent>
            </Card>
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
});
