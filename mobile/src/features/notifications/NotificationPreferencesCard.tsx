import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { useToast } from "@/providers/ToastProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";

type Channel = "push" | "email";

/** GET/PUT /notifications/preferences (backend src/notifications). */
interface NotificationPreferences {
  push: Record<string, boolean>;
  email: Record<string, boolean>;
  categories?: { key: string; label: string }[];
}

const FALLBACK_CATEGORIES = [
  { key: "announcements", label: "Announcements" },
  { key: "coursework", label: "New work and peer reviews" },
  { key: "grades", label: "Grades and feedback" },
  { key: "discussions", label: "Discussions" },
  { key: "attendance", label: "Attendance" },
  { key: "chat", label: "Messages" },
];

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "push", label: "Push" },
  { key: "email", label: "Email" },
];

/**
 * The account's own notification preferences (staff and students): each
 * category on or off for push and for email. Parents' notices about their
 * children have their own settings on the parent settings screen.
 */
export function NotificationPreferencesCard({ refreshKey }: { refreshKey?: number }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<NotificationPreferences>("/notifications/preferences")
      .then(setPrefs)
      .catch(() => setPrefs(null));
  }, [refreshKey]);

  async function toggle(channel: Channel, key: string, on: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...before, [channel]: { ...before[channel], [key]: on } });
    setSaving(true);
    try {
      setPrefs(
        await api<NotificationPreferences>("/notifications/preferences", {
          method: "PUT",
          body: { [channel]: { [key]: on } },
        }),
      );
    } catch (err) {
      setPrefs(before);
      toast.error(userMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return null;
  const rows = prefs.categories?.length ? prefs.categories : FALLBACK_CATEGORIES;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>What you are told about, on this app and by email.</CardDescription>
      </CardHeader>
      <CardContent style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }} />
          {CHANNELS.map((c) => (
            <Text key={c.key} variant="muted" size="xs" style={{ width: 52, textAlign: "center" }}>
              {c.label}
            </Text>
          ))}
        </View>
        {rows.map((row) => (
          <View key={row.key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ flex: 1 }}>{row.label}</Text>
            {CHANNELS.map((c) => (
              <View key={c.key} style={{ width: 52, alignItems: "center" }}>
                <Switch
                  value={prefs[c.key]?.[row.key] !== false}
                  disabled={saving}
                  onValueChange={(on) => void toggle(c.key, row.key, on)}
                  accessibilityLabel={`${row.label}: ${c.label}`}
                />
              </View>
            ))}
          </View>
        ))}
      </CardContent>
    </Card>
  );
}
