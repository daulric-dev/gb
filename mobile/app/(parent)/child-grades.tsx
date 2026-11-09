import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { gradeText, type ParentChild, type ParentCourse, type ParentCourseGrades } from "@/lib/parent";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import { ParentScreen, formatWhen, useChildResource } from "@/features/parent/ParentScreen";

const STATUS = {
  graded: "Marked",
  submitted: "Handed in",
  excused: "Excused",
  not_submitted: "Not handed in",
} as const;

function CourseRow({ childId, course }: { childId: string; course: ParentCourse }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ParentCourseGrades | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try {
        setDetail(await api<ParentCourseGrades>(`/parent/children/${childId}/courses/${course.id}/grades`));
      } catch (err) {
        setError(userMessage(err, "Grades could not be loaded"));
      }
    }
  }

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Card>
      <Pressable onPress={() => void toggle()} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <CardContent style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text weight="600" numberOfLines={1}>
              {course.name}
            </Text>
            <Text variant="muted" size="xs">
              {gradeText(course.grade)}
            </Text>
          </View>
          <Chevron size={16} color={colors.mutedForeground} />
        </CardContent>
      </Pressable>
      {open ? (
        <CardContent style={{ gap: 10, paddingTop: 0 }}>
          {error ? <Text variant="muted">{error}</Text> : null}
          {detail?.activities.length === 0 ? <Text variant="muted">No work yet.</Text> : null}
          {detail?.activities.map((a) => (
            <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{a.title}</Text>
                <Text variant="muted" size="xs">
                  {a.dueAt ? `due ${formatWhen(a.dueAt)}` : "no due date"}
                  {a.dropped ? " · dropped" : ""}
                </Text>
              </View>
              {a.score !== null ? (
                <Text size="sm">
                  {a.score} / {a.points}
                </Text>
              ) : null}
              <Badge variant="outline">{STATUS[a.status]}</Badge>
            </View>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

function Grades({ child }: { child: ParentChild }) {
  const courses = useChildResource<ParentCourse[]>(`/parent/children/${child.id}/courses`);
  if (courses.error) return <Text variant="muted">{courses.error}</Text>;
  if (!courses.data) return null;
  if (courses.data.length === 0) return <Text variant="muted">Not enrolled in any course yet.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {courses.data.map((c) => (
        <CourseRow key={c.id} childId={child.id} course={c} />
      ))}
    </View>
  );
}

export default function ParentGradesScreen() {
  return <ParentScreen title="Grades" render={(child) => <Grades key={child.id} child={child} />} />;
}
