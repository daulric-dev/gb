import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { staffCourseHref, type StaffCourse } from "@/lib/course";
import { WebHint } from "@/features/course/StaffSections";

const ROLE_LABEL = { admin: "Admin", teacher: "Teacher", ta: "TA" } as const;

/** The courses a staff member teaches (all of them, for a school admin). */
export default function TeachingCoursesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [courses, setCourses] = useState<StaffCourse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setCourses(await api<StaffCourse[]>("/courses").catch(() => null));
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const order = { published: 0, draft: 1, archived: 2 } as const;
  const sorted = [...(courses ?? [])].sort(
    (a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name),
  );

  return (
    <Screen
      title="Courses"
      description="Modules, marking, announcements and discussions"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <Skeleton style={{ height: 200 }} />
      ) : courses === null ? (
        <EmptyState
          icon={BookOpen}
          title="Courses could not be loaded"
          description="Pull down to try again."
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Create a course on the web app; it shows up here."
        />
      ) : (
        <View style={{ gap: 10 }}>
          {sorted.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push(staffCourseHref(c.id))}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card>
                <CardContent style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="600" numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text variant="muted" size="xs">
                      {[
                        c.code,
                        `${c.studentCount ?? 0} students`,
                        c.role ? ROLE_LABEL[c.role] : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {c.status !== "published" && (
                    <Badge variant="secondary">
                      {c.status === "draft" ? "Draft" : "Archived"}
                    </Badge>
                  )}
                  <ChevronRight color={colors.mutedForeground} size={16} />
                </CardContent>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
      <WebHint>Create courses and build their content on the web app.</WebHint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
});
