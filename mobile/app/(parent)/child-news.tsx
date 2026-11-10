import { View } from "react-native";
import {
  announcementSource,
  personName,
  type ParentAnnouncement,
  type ParentChild,
} from "@/lib/parent";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Markdown } from "@/components/ui/Markdown";
import { Text } from "@/components/ui/Text";
import { ParentScreen, formatWhen, useChildResource } from "@/features/parent/ParentScreen";

function Announcements({ child }: { child: ParentChild }) {
  const res = useChildResource<ParentAnnouncement[]>(`/parent/children/${child.id}/announcements`);
  if (res.error) return <Text variant="muted">{res.error}</Text>;
  if (!res.data) return null;
  if (res.data.length === 0) return <Text variant="muted">No announcements yet.</Text>;
  return (
    <View style={{ gap: 12 }}>
      {res.data.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle>{a.title}</CardTitle>
            {a.scope === "school" ? (
              <View style={{ flexDirection: "row" }}>
                <Badge>School</Badge>
              </View>
            ) : null}
            <CardDescription>
              {announcementSource(a)} ·{" "}
              {personName(a.author, a.scope === "school" ? "School" : "Teacher")} ·{" "}
              {formatWhen(a.createdAt)}
            </CardDescription>
          </CardHeader>
          {a.body ? (
            <CardContent>
              <Markdown>{a.body}</Markdown>
            </CardContent>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

export default function ParentAnnouncementsScreen() {
  return (
    <ParentScreen title="Announcements" render={(child) => <Announcements key={child.id} child={child} />} />
  );
}
