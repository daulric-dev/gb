import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  GraduationCap,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { teacherNames, type PortalCourseCard } from "@/lib/portal";
import { averagePercent, gradeColor, percentLabel } from "@/lib/grades";
import { GradeBar, LetterBadge } from "@/features/grades/GradeBits";

function CourseGradeCard({ course }: { course: PortalCourseCard }) {
  const router = useRouter();
  const { colors } = useTheme();
  const percent = course.grade?.percent ?? null;
  const label = percentLabel(percent);
  const color = gradeColor(percent);
  const teachers = teacherNames(course.teachers);

  return (
    <Pressable
      onPress={() => router.push(`/grades/${course.id}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card>
        <CardContent style={{ gap: 12 }}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="600" numberOfLines={1}>
                {course.name}
              </Text>
              <Text variant="muted" size="xs" numberOfLines={1}>
                {[course.code, teachers].filter(Boolean).join(" · ") ||
                  "Course"}
              </Text>
            </View>
            <ChevronRight color={colors.mutedForeground} size={16} />
          </View>

          <View style={styles.scoreRow}>
            <Text
              style={{
                fontSize: 30,
                fontWeight: "700",
                color: color ?? colors.mutedForeground,
              }}
            >
              {label ?? "—"}
            </Text>
            {label ? (
              <LetterBadge letter={course.grade?.letter} percent={percent} />
            ) : (
              <Text variant="muted" size="xs">
                No marks yet
              </Text>
            )}
          </View>

          <GradeBar percent={percent} />
        </CardContent>
      </Card>
    </Pressable>
  );
}

/**
 * The student's standing in every course, current ones first. Archived
 * courses are history, so they sit folded away underneath.
 */
export default function PortalGradesScreen() {
  const { colors } = useTheme();
  const [courses, setCourses] = useState<PortalCourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(
    () =>
      api<PortalCourseCard[]>("/portal/me/courses")
        .then(setCourses)
        .catch(() => setCourses([])),
    [],
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const current = courses.filter((c) => c.status !== "archived");
  const past = courses.filter((c) => c.status === "archived");
  const average = averagePercent(current.map((c) => c.grade?.percent));
  const averageColor = gradeColor(average);
  const marked = current.filter((c) => c.grade?.percent != null).length;

  return (
    <Screen
      title="Grades"
      description="How you are doing in each course"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 96 }} />
          <Skeleton style={{ height: 130 }} />
          <Skeleton style={{ height: 130 }} />
        </View>
      ) : courses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No courses yet"
          description="When a teacher adds you to a course, your grades show up here."
        />
      ) : (
        <View style={{ gap: 12 }}>
          {current.length > 0 && (
            <Card>
              <CardContent style={styles.average}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="muted" size="xs">
                    Average across current courses
                  </Text>
                  <Text
                    style={{
                      fontSize: 34,
                      fontWeight: "700",
                      color: averageColor ?? colors.mutedForeground,
                    }}
                  >
                    {percentLabel(average) ?? "—"}
                  </Text>
                  <Text variant="muted" size="xs">
                    {average === null
                      ? "No marks yet"
                      : `From ${marked} of ${current.length} course${current.length === 1 ? "" : "s"}`}
                  </Text>
                </View>
                <GraduationCap color={colors.mutedForeground} size={32} />
              </CardContent>
            </Card>
          )}

          {current.map((course) => (
            <CourseGradeCard key={course.id} course={course} />
          ))}

          {past.length > 0 && (
            <Card>
              <Pressable
                onPress={() => setShowPast((v) => !v)}
                style={({ pressed }) => [
                  styles.pastHeader,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <CardTitle>Past courses</CardTitle>
                  <Text variant="muted" size="xs">
                    {past.length} archived
                  </Text>
                </View>
                {showPast ? (
                  <ChevronDown color={colors.mutedForeground} size={18} />
                ) : (
                  <ChevronRight color={colors.mutedForeground} size={18} />
                )}
              </Pressable>
              {showPast && (
                <CardContent style={{ gap: 8, paddingTop: 0 }}>
                  {past.map((course) => (
                    <PastRow key={course.id} course={course} />
                  ))}
                </CardContent>
              )}
            </Card>
          )}
        </View>
      )}
    </Screen>
  );
}

function PastRow({ course }: { course: PortalCourseCard }) {
  const router = useRouter();
  const { colors } = useTheme();
  const percent = course.grade?.percent ?? null;
  const label = percentLabel(percent);

  return (
    <Pressable
      onPress={() => router.push(`/grades/${course.id}`)}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="500" numberOfLines={1}>
          {course.name}
        </Text>
        {course.code ? (
          <Text variant="muted" size="xs" numberOfLines={1}>
            {course.code}
          </Text>
        ) : null}
      </View>
      <Text
        weight="600"
        style={{ color: gradeColor(percent) ?? colors.mutedForeground }}
      >
        {label ?? "—"}
      </Text>
      <LetterBadge letter={course.grade?.letter} percent={percent} />
      <ChevronRight color={colors.mutedForeground} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  average: { flexDirection: "row", alignItems: "center", gap: 12 },
  pastHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
