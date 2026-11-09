import { View } from "react-native";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import {
  WORK_STATE_LABELS,
  gradeText,
  personName,
  type ParentChild,
  type ParentOverview,
  type ParentWork,
  type ParentWorkItem,
} from "@/lib/parent";
import { ParentScreen, formatWhen, useChildResource } from "@/features/parent/ParentScreen";

function WorkList({ title, items, empty }: { title: string; items: ParentWorkItem[]; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent style={{ gap: 10 }}>
        {items.length === 0 ? (
          <Text variant="muted">{empty}</Text>
        ) : (
          items.map((w) => (
            <View key={w.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text weight="500" numberOfLines={1}>
                  {w.title}
                </Text>
                <Text variant="muted" size="xs" numberOfLines={1}>
                  {w.courseName ?? "Course"} · due {formatWhen(w.dueAt, true)}
                  {w.hasExtension ? " (extended)" : ""}
                </Text>
              </View>
              <Badge variant="outline">{WORK_STATE_LABELS[w.state]}</Badge>
            </View>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Overview({ child }: { child: ParentChild }) {
  const overview = useChildResource<ParentOverview>(`/parent/children/${child.id}`);
  const work = useChildResource<ParentWork>(
    child.visibility.work ? `/parent/children/${child.id}/work` : null,
  );
  const o = overview.data;

  if (overview.error) return <Text variant="muted">{overview.error}</Text>;
  if (!o) return null;

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 10 }}>
          {o.courses.length === 0 ? (
            <Text variant="muted">Not enrolled in any course yet.</Text>
          ) : (
            o.courses.map((c) => (
              <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text weight="500" numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text variant="muted" size="xs" numberOfLines={1}>
                    {c.teachers.map((t) => personName(t)).filter(Boolean).join(", ") || "No teacher listed"}
                  </Text>
                </View>
                {o.visibility.grades ? <Text size="sm">{gradeText(c.grade)}</Text> : null}
              </View>
            ))
          )}
        </CardContent>
      </Card>
      {work.error ? <Text variant="muted">{work.error}</Text> : null}
      {work.data ? (
        <>
          <WorkList title="Missing work" items={work.data.missing} empty="Nothing missing." />
          <WorkList title="Upcoming work" items={work.data.upcoming} empty="Nothing due." />
        </>
      ) : null}
    </View>
  );
}

export default function ParentOverviewScreen() {
  return <ParentScreen title="Overview" render={(child) => <Overview key={child.id} child={child} />} />;
}
