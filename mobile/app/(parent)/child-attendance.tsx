import { View } from "react-native";
import { attendanceRate, type ParentAttendance, type ParentChild } from "@/lib/parent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { ParentScreen, formatWhen, useChildResource } from "@/features/parent/ParentScreen";

const LABEL = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" } as const;

function Attendance({ child }: { child: ParentChild }) {
  const res = useChildResource<ParentAttendance>(`/parent/children/${child.id}/attendance`);
  if (res.error) return <Text variant="muted">{res.error}</Text>;
  const a = res.data;
  if (!a) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text variant="muted">
        {attendanceRate(a.summary)} attended · {a.summary.absent} absent · {a.summary.late} late
      </Text>
      {a.courses.length === 0 ? <Text variant="muted">No attendance yet.</Text> : null}
      {a.courses.map((c) => (
        <Card key={c.courseId}>
          <CardHeader>
            <CardTitle>
              {c.courseName} · {attendanceRate(c.summary)}
            </CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 8 }}>
            {c.records.length === 0 ? <Text variant="muted">No sessions yet.</Text> : null}
            {c.records.slice(0, 30).map((r) => (
              <View key={r.sessionId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1}>{r.title || "Session"}</Text>
                  <Text variant="muted" size="xs">
                    {formatWhen(r.openedAt, true)}
                  </Text>
                </View>
                <Badge variant="outline">{r.status ? LABEL[r.status] : "Not recorded"}</Badge>
              </View>
            ))}
          </CardContent>
        </Card>
      ))}
    </View>
  );
}

export default function ParentAttendanceScreen() {
  return <ParentScreen title="Attendance" render={(child) => <Attendance key={child.id} child={child} />} />;
}
