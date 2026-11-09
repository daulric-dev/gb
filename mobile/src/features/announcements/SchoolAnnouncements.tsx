import { useEffect, useState } from "react";
import { View } from "react-native";
import { Megaphone } from "lucide-react-native";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { Markdown } from "@/components/ui/Markdown";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/theme/ThemeProvider";
import { initials, timeAgo } from "@/lib/course";
import type { SchoolAnnouncement } from "@/lib/announcement-audience";

const PREVIEW = 3;

/**
 * Student home: the school's announcements for everyone
 * (GET /portal/me/announcements). Never staff-only notices; course posts stay
 * in each course. Draws nothing while there are none. `refreshKey` reloads.
 */
export function SchoolAnnouncements({ refreshKey = 0 }: { refreshKey?: number }) {
  const { colors } = useTheme();
  const [items, setItems] = useState<SchoolAnnouncement[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    api<SchoolAnnouncement[]>("/portal/me/announcements")
      .then((data) => live && setItems(data ?? []))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, PREVIEW);

  return (
    <Card>
      <CardHeader style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Megaphone size={18} color={colors.mutedForeground} />
        <CardTitle>School announcements</CardTitle>
      </CardHeader>
      <CardContent style={{ gap: 14 }}>
        {shown.map((a) => {
          const name =
            [a.author?.first_name, a.author?.last_name].filter(Boolean).join(" ") ||
            "School";
          return (
            <View key={a.id} style={{ flexDirection: "row", gap: 10 }}>
              <Avatar
                uri={a.author?.avatar_url}
                fallback={initials(a.author?.first_name, a.author?.last_name)}
                size={32}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text weight="600">{a.title}</Text>
                <Text variant="muted" size="xs">
                  {name} · {timeAgo(a.created_at)}
                </Text>
                {a.body ? <Markdown>{a.body}</Markdown> : null}
              </View>
            </View>
          );
        })}
        {items.length > PREVIEW ? (
          <Button variant="outline" onPress={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all (${items.length})`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
