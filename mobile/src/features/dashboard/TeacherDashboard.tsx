import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { BookOpen, Hand, Users } from "lucide-react-native";
import { api } from "@/lib/api";
import type { CourseSummary } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { StatCard } from "@/components/ui/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { CoursesOnWebCard } from "./CoursesOnWebCard";
import { staffCourseHref } from "@/lib/course";

/**
 * The staff member's courses at a glance. A course opens its staff screen
 * (marking, modules, announcements, discussions); building content is
 * web-only. Taking attendance is the one quick action.
 */
export function TeacherDashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    let cancelled = false;
    api<CourseSummary[]>("/courses")
      .then((data) => !cancelled && setCourses(data))
      .catch(() => !cancelled && setCourses([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const active = courses.filter((c) => c.status !== "archived");
  const totalStudents = active.reduce((sum, c) => sum + (c.studentCount ?? 0), 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.statGrid}>
        <StatCard
          icon={BookOpen}
          value={active.length}
          label="My Courses"
          loading={loading}
        />
        <StatCard
          icon={Users}
          value={totalStudents}
          label="Students"
          loading={loading}
        />
      </View>

      <CoursesOnWebCard />

      {loading ? (
        <Skeleton style={{ height: 120, borderRadius: 14 }} />
      ) : active.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>My Courses</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 10 }}>
            {active.map((c) => (
              <View key={c.id} style={styles.row}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push(staffCourseHref(c.id))}
                >
                  <Text weight="500" numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text variant="muted" size="xs">
                    {[c.code, `${c.studentCount ?? 0} students`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Pressable>
                {c.status === "draft" ? (
                  <Badge variant="secondary">Draft</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Hand size={14} color={colors.secondaryForeground} />}
                    onPress={() =>
                      router.push(
                        `/attendance/take/${c.id}?name=${encodeURIComponent(c.name)}` as Href,
                      )
                    }
                  >
                    Take attendance
                  </Button>
                )}
              </View>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
