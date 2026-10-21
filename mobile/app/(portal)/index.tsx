import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen, NotebookPen } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import {
  formatPercent,
  teacherNames,
  type PortalCourseCard,
  type PortalMe,
} from "@/lib/portal";
import { isOutstanding, type PortalWorkItem } from "@/lib/work";

/**
 * Student home: the courses they sit and how much work is outstanding. The
 * full course view (modules, pages, grades) lives on the web app for now.
 */
export default function PortalHomeScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [courses, setCourses] = useState<PortalCourseCard[]>([]);
  const [work, setWork] = useState<PortalWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [meData, courseData, workData] = await Promise.all([
      api<PortalMe>("/portal/me").catch(() => null),
      api<PortalCourseCard[]>("/portal/me/courses").catch(() => []),
      api<PortalWorkItem[]>("/portal/me/activities").catch(() => []),
    ]);
    setMe(meData);
    setCourses(courseData ?? []);
    setWork(workData ?? []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const active = courses.filter((c) => c.status !== "archived");
  const todo = work.filter(isOutstanding).length;

  return (
    <Screen
      title={`Hello ${me?.firstName ?? profile?.first_name ?? "there"}`}
      description={profile?.school?.name ?? undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.stats}>
        <StatCard
          icon={BookOpen}
          value={active.length}
          label="Courses"
          loading={loading}
        />
        <Pressable style={{ flex: 1 }} onPress={() => router.push("/(portal)/work")}>
          <StatCard
            icon={NotebookPen}
            value={todo}
            label="To do"
            loading={loading}
          />
        </Pressable>
      </View>

      {loading ? (
        <Skeleton style={{ height: 160 }} />
      ) : active.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="When a teacher adds you to a course it shows up here."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your courses</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8 }}>
            {active.map((c) => {
              const percent = formatPercent(c.grade?.percent);
              const teachers = teacherNames(c.teachers);
              return (
                <View
                  key={c.id}
                  style={[styles.courseRow, { borderColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="500" numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text variant="muted" size="xs" numberOfLines={1}>
                      {[c.code, teachers].filter(Boolean).join(" · ") ||
                        "Course"}
                    </Text>
                  </View>
                  {percent && (
                    <Badge>
                      {percent}
                      {c.grade?.letter ? ` ${c.grade.letter}` : ""}
                    </Badge>
                  )}
                </View>
              );
            })}
            <Text variant="muted" size="xs" style={{ marginTop: 4 }}>
              Open the web app to see course modules, pages and grades.
            </Text>
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: 12 },
  courseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
