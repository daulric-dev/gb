import { View } from "react-native";
import type { ParentChild } from "@/lib/parent";
import { parentOutcomesPath, type MyOutcomes } from "@/lib/mastery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { OutcomeList } from "@/components/mastery/OutcomeList";
import { ParentScreen, useChildResource } from "@/features/parent/ParentScreen";

/** A child's mastery of learning outcomes (only when the school shows it to parents). */
function Outcomes({ child }: { child: ParentChild }) {
  const res = useChildResource<MyOutcomes>(parentOutcomesPath(child.id));
  if (res.error) return <Text variant="muted">{res.error}</Text>;
  if (!res.data) return null;
  if (res.data.courses.length === 0) return <Text variant="muted">No outcomes are tracked yet.</Text>;
  const { scale } = res.data;
  return (
    <View style={{ gap: 12 }}>
      {res.data.courses.map((c) => (
        <Card key={c.courseId}>
          <CardHeader>
            <CardTitle>{c.courseName}</CardTitle>
          </CardHeader>
          <CardContent>
            <OutcomeList outcomes={c.outcomes} scale={scale} />
          </CardContent>
        </Card>
      ))}
    </View>
  );
}

export default function ParentOutcomesScreen() {
  return <ParentScreen title="Outcomes" render={(child) => <Outcomes key={child.id} child={child} />} />;
}
