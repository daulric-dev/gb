import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  PenLine,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressRing } from "@/components/charts/ProgressRing";
import { useTheme } from "@/theme/ThemeProvider";
import { teacherNames, type PortalCourseCard } from "@/lib/portal";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import {
  activityGradeState,
  gradeColor,
  percentLabel,
  type PortalCourseGrades,
  type PortalGradeActivity,
} from "@/lib/grades";
import { GradeBar } from "@/features/grades/GradeBits";

const UNGROUPED = "Ungrouped";

function ActivityRow({ item }: { item: PortalGradeActivity }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const Icon =
    item.kind === "quiz"
      ? ClipboardList
      : item.kind === "offline"
        ? PenLine
        : FileText;
  const state = activityGradeState(item);
  const feedback = item.submission?.feedback?.trim() || null;

  return (
    <Pressable
      onPress={() => router.push(`/work/${item.id}`)}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.rowTop}>
        <Icon color={colors.mutedForeground} size={18} />
        <View style={styles.rowBody}>
          <Text weight="500" numberOfLines={1}>
            {item.title}
          </Text>
          <Text variant="muted" size="xs">
            {dueLabel(item.dueAt)}
          </Text>
        </View>
        {state.kind === "graded" ? (
          <Text weight="600">
            {formatScore(state.score)}/{formatScore(item.points)}
          </Text>
        ) : state.kind === "excused" ? (
          <Badge variant="secondary">Excused</Badge>
        ) : state.kind === "missing" ? (
          <Badge variant="outline" color={colors.destructive}>
            Missing
          </Badge>
        ) : (
          <Text variant="muted" size="xs">
            Not graded yet
          </Text>
        )}
        <ChevronRight color={colors.mutedForeground} size={16} />
      </View>

      {feedback ? (
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={4}
          style={({ pressed }) => [
            styles.feedback,
            { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={styles.feedbackHead}>
            <Text variant="label" style={{ flex: 1 }}>
              Feedback
            </Text>
            {open ? (
              <ChevronDown color={colors.mutedForeground} size={14} />
            ) : (
              <ChevronRight color={colors.mutedForeground} size={14} />
            )}
          </View>
          <Text variant="muted" size="xs" numberOfLines={open ? undefined : 1}>
            {feedback}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * One course's grade: the running total, how each assignment group adds up,
 * and every piece of work with its mark.
 */
export default function CourseGradesScreen() {
  const router = useRouter();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { colors } = useTheme();
  const [data, setData] = useState<PortalCourseGrades | null>(null);
  const [course, setCourse] = useState<PortalCourseCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!courseId) return;
    const [grades, courses] = await Promise.all([
      api<PortalCourseGrades>(`/portal/me/courses/${courseId}/grades`).catch(
        () => null,
      ),
      api<PortalCourseCard[]>("/portal/me/courses").catch(() => []),
    ]);
    setData(grades);
    setCourse((courses ?? []).find((c) => c.id === courseId) ?? null);
  }, [courseId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const title = course?.name ?? "Grades";
  const description =
    [course?.code, course ? teacherNames(course.teachers) : null]
      .filter(Boolean)
      .join(" · ") || undefined;

  if (loading) {
    return (
      <Screen title={title} onBack={() => router.back()}>
        <Skeleton style={{ height: 220 }} />
        <Skeleton style={{ height: 140 }} />
        <Skeleton style={{ height: 200 }} />
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen
        title={title}
        description="Grades could not be loaded"
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const percent = data.grade.percent;
  const color = gradeColor(percent) ?? colors.mutedForeground;

  // Activities in the order the course lays out its groups, then any group
  // the summary does not know about, then the ungrouped ones last.
  const order = data.grade.groups.map((g) => g.name);
  const buckets = new Map<string, PortalGradeActivity[]>();
  for (const name of order) buckets.set(name, []);
  for (const a of data.activities) {
    const name = a.groupName ?? UNGROUPED;
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name)!.push(a);
  }
  const sections = [...buckets.entries()].filter(([, items]) => items.length);

  return (
    <Screen
      title={title}
      description={description}
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Card>
        <CardContent style={styles.total}>
          <ProgressRing percent={percent} color={color}>
            <Text style={{ fontSize: 28, fontWeight: "700", color }}>
              {percentLabel(percent) ?? "—"}
            </Text>
            {data.grade.letter && percent !== null ? (
              <Text weight="600" style={{ color }}>
                {data.grade.letter}
              </Text>
            ) : (
              <Text variant="muted" size="xs">
                {percent === null ? "No marks yet" : "Total"}
              </Text>
            )}
          </ProgressRing>
        </CardContent>
      </Card>

      {data.grade.groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Breakdown</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 14 }}>
            {data.grade.groups.map((g) => (
              <View key={g.groupId ?? g.name} style={{ gap: 6 }}>
                <View style={styles.groupTop}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="500" numberOfLines={1}>
                      {g.name}
                    </Text>
                    <Text variant="muted" size="xs">
                      {[
                        g.weight !== null
                          ? `${formatScore(g.weight)}% of total`
                          : null,
                        `${formatScore(g.earned)}/${formatScore(g.possible)} points`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <Text
                    weight="600"
                    style={{
                      color: gradeColor(g.percent) ?? colors.mutedForeground,
                    }}
                  >
                    {percentLabel(g.percent) ?? "—"}
                  </Text>
                </View>
                <GradeBar percent={g.percent} height={4} />
              </View>
            ))}
          </CardContent>
        </Card>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No graded work yet"
          description="Quizzes and assignments show up here once your teacher publishes them."
        />
      ) : (
        sections.map(([name, items]) => (
          <Card key={name}>
            <CardHeader>
              <CardTitle>{name}</CardTitle>
            </CardHeader>
            <CardContent style={{ gap: 8 }}>
              {items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { alignItems: "center", paddingVertical: 24 },
  groupTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  row: {
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowBody: { flex: 1, gap: 2 },
  feedback: { borderRadius: 10, padding: 10, gap: 4 },
  feedbackHead: { flexDirection: "row", alignItems: "center", gap: 6 },
});
