import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import {
  BookOpen,
  ChevronRight,
  NotebookPen,
  Plus,
  ScanLine,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { ReadOnlyBanner } from "@/features/billing/ReadOnlyBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import {
  teacherNames,
  type PortalCourseCard,
  type PortalMe,
} from "@/lib/portal";
import { gradeColor, percentLabel } from "@/lib/grades";
import { LetterBadge } from "@/features/grades/GradeBits";
import { isOutstanding, type PortalWorkItem } from "@/lib/work";
import { OpenAttendanceCards } from "@/features/attendance/OpenAttendanceCards";
import { studentCourseHref } from "@/lib/course";
import { JoinCourseSheet } from "@/features/course/JoinCourseSheet";

/**
 * Student home: the courses they sit and how much work is outstanding. A
 * course row opens the course screen.
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [joinOpen, setJoinOpen] = useState(false);

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
    setRefreshKey((k) => k + 1);
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
      <ReadOnlyBanner />
      <Button
        size="lg"
        icon={<ScanLine color={colors.primaryForeground} size={20} />}
        onPress={() => router.push("/attendance/scan")}
      >
        Scan attendance QR
      </Button>

      <OpenAttendanceCards refreshKey={refreshKey} />

      <View style={styles.stats}>
        <StatCard
          icon={BookOpen}
          value={active.length}
          label="Courses"
          loading={loading}
        />
        <Pressable
          style={{ flex: 1 }}
          onPress={() => router.push("/(portal)/work")}
        >
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
          description="Join one with the code or QR your teacher shares, or wait for them to add you."
          action={
            <Button
              onPress={() => setJoinOpen(true)}
              icon={<Plus color={colors.primaryForeground} size={18} />}
            >
              Join a course
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your courses</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8 }}>
            {active.map((c) => {
              const percent = c.grade?.percent ?? null;
              const label = percentLabel(percent);
              const teachers = teacherNames(c.teachers);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(studentCourseHref(c.id))}
                  style={({ pressed }) => [
                    styles.courseRow,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
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
                  {label && (
                    <Text weight="600" style={{ color: gradeColor(percent)! }}>
                      {label}
                    </Text>
                  )}
                  <LetterBadge letter={c.grade?.letter} percent={percent} />
                  <ChevronRight color={colors.mutedForeground} size={16} />
                </Pressable>
              );
            })}
            <Text variant="muted" size="xs" style={{ marginTop: 4 }}>
              Tap a course for its modules, work, grades and discussions.
            </Text>
            <Button
              variant="outline"
              onPress={() => setJoinOpen(true)}
              icon={<Plus color={colors.foreground} size={18} />}
            >
              Join a course
            </Button>
          </CardContent>
        </Card>
      )}

      <JoinCourseSheet
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={() => void load()}
      />
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
