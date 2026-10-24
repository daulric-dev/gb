import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronRight, Users } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Markdown } from "@/components/ui/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTheme } from "@/theme/ThemeProvider";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import {
  href,
  type StaffActivity,
  type TeacherSubmissionRow,
} from "@/lib/course";
import { WebHint } from "@/features/course/StaffSections";

type Filter = "all" | "tomark" | "marked";

/** Where one roster row stands, for its badge and the filter. */
function rowState(r: TeacherSubmissionRow) {
  const s = r.submission;
  if (s?.excused) return "excused" as const;
  if (s?.status === "graded" && s.score !== null) return "marked" as const;
  if (s && s.status === "submitted") return "tomark" as const;
  return "none" as const;
}

/**
 * One activity's roster for marking: every student with their submission
 * (or lack of one). Tapping a student opens the marking screen.
 */
export default function ActivitySubmissionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { courseId, activityId } = useLocalSearchParams<{
    courseId: string;
    activityId: string;
  }>();
  const [activity, setActivity] = useState<StaffActivity | null>(null);
  const [rows, setRows] = useState<TeacherSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    if (!activityId) return;
    const [a, subs] = await Promise.all([
      api<StaffActivity>(`/activities/${activityId}`).catch(() => null),
      api<TeacherSubmissionRow[]>(`/activities/${activityId}/submissions`).catch(
        () => null,
      ),
    ]);
    setActivity(a);
    setRows(subs ?? []);
  }, [activityId]);

  // Loads on open, and again on the way back from marking someone.
  useFocusEffect(
    useCallback(() => {
      load().finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  if (loading) {
    return (
      <Screen title="Marking" onBack={() => router.back()}>
        <Skeleton style={{ height: 120 }} />
        <Skeleton style={{ height: 300 }} />
      </Screen>
    );
  }

  if (!activity) {
    return (
      <Screen
        title="Marking"
        description="This activity could not be loaded"
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const counts = {
    handedIn: rows.filter((r) => r.submission && r.submission.status !== "draft")
      .length,
    toMark: rows.filter((r) => rowState(r) === "tomark").length,
    marked: rows.filter((r) => rowState(r) === "marked").length,
  };
  const visible = rows.filter((r) =>
    filter === "all" ? true : rowState(r) === filter,
  );
  const kind =
    activity.kind === "quiz"
      ? "Quiz"
      : activity.kind === "offline"
        ? "Offline"
        : "Assignment";

  return (
    <Screen
      title={activity.title}
      description={[
        kind,
        `${formatScore(activity.points)} pts`,
        dueLabel(activity.dueAt),
      ].join(" · ")}
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {activity.instructions?.trim() ? (
        <Card>
          <CardContent>
            <Markdown>{activity.instructions}</Markdown>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent style={styles.stats}>
          {(
            [
              ["Handed in", counts.handedIn],
              ["To mark", counts.toMark],
              ["Marked", counts.marked],
              ["Students", rows.length],
            ] as const
          ).map(([label, n]) => (
            <View key={label} style={{ flex: 1, alignItems: "center" }}>
              <Text weight="700" size="lg">
                {n}
              </Text>
              <Text variant="muted" size="xs">
                {label}
              </Text>
            </View>
          ))}
        </CardContent>
      </Card>

      <SegmentedControl
        options={[
          { value: "all", label: "All" },
          { value: "tomark", label: "To mark" },
          { value: "marked", label: "Marked" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={rows.length === 0 ? "No students yet" : "Nobody here"}
          description={
            rows.length === 0
              ? "Students enrolled in the course show up here."
              : "No student matches this filter."
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8, paddingTop: 8 }}>
            {visible.map((r) => {
              const state = rowState(r);
              return (
                <Pressable
                  key={r.studentId}
                  onPress={() =>
                    router.push(
                      href(`/teaching/${courseId}/mark/${activityId}/${r.studentId}`),
                    )
                  }
                  style={({ pressed }) => [
                    styles.row,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="500" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text variant="muted" size="xs">
                      {r.submission?.submittedAt
                        ? `Handed in ${new Date(r.submission.submittedAt).toLocaleDateString()}`
                        : activity.kind === "offline"
                          ? "Offline"
                          : "Not handed in"}
                      {r.enrollmentStatus !== "active"
                        ? ` · ${r.enrollmentStatus}`
                        : ""}
                    </Text>
                  </View>
                  {state === "marked" ? (
                    <Text weight="600">
                      {formatScore(r.submission!.score)}/
                      {formatScore(activity.points)}
                    </Text>
                  ) : state === "excused" ? (
                    <Badge variant="secondary">Excused</Badge>
                  ) : state === "tomark" ? (
                    <Badge variant="default">To mark</Badge>
                  ) : null}
                  <ChevronRight color={colors.mutedForeground} size={16} />
                </Pressable>
              );
            })}
          </CardContent>
        </Card>
      )}

      <WebHint>Edit the activity, its questions or its rubric on the web app.</WebHint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", paddingVertical: 16, paddingHorizontal: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
