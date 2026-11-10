import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { studentCourseHref } from "@/lib/course";
import { rateLabel, type PortalAttendanceSummary } from "@/lib/timetable";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";

/** Below this an attendance rate is shown in the warning colour. */
const LOW_RATE = 90;

/**
 * The student's own attendance: overall and per course, counting only the
 * sessions they have a record in (excused ones do not count either way).
 * Hidden until there is something to show, and on an older server.
 */
export function AttendanceSummaryCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [data, setData] = useState<PortalAttendanceSummary | null>(null);

  useEffect(() => {
    api<PortalAttendanceSummary>("/portal/me/attendance/summary")
      .then(setData)
      .catch(() => setData(null));
  }, [refreshKey]);

  const courses = (data?.courses ?? []).filter((c) => c.summary.rate !== null);
  if (!data || data.overall.rate === null) return null;

  const tone = (rate: number | null) =>
    rate !== null && rate < LOW_RATE ? colors.destructive : colors.foreground;
  const o = data.overall;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        <CardDescription>
          {`${o.present + o.late} attended · ${o.absent} absent · ${o.late} late`}
        </CardDescription>
      </CardHeader>
      <CardContent style={{ gap: 8 }}>
        <View
          accessible
          accessibilityLabel={`Overall attendance ${rateLabel(o.rate)}`}
          style={styles.overall}
        >
          <Text size="3xl" weight="700" style={{ color: tone(o.rate) }}>
            {rateLabel(o.rate)}
          </Text>
          <Text variant="muted" size="sm">
            overall
          </Text>
        </View>
        {courses.map((c) => (
          <Pressable
            key={c.courseId}
            onPress={() => router.push(studentCourseHref(c.courseId))}
            accessibilityRole="button"
            accessibilityLabel={`${c.courseName}: attendance ${rateLabel(c.summary.rate)}`}
            style={({ pressed }) => [
              styles.row,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text weight="500" numberOfLines={1} style={{ flex: 1 }}>
              {c.courseName}
            </Text>
            <Text weight="600" style={{ color: tone(c.summary.rate) }}>
              {rateLabel(c.summary.rate)}
            </Text>
          </Pressable>
        ))}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  overall: { flexDirection: "row", alignItems: "baseline", gap: 8 },
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
