import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  NOTICE_KINDS,
  NOTICE_LABELS,
  personName,
  relationshipText,
  toggleNoticeKind,
  type ParentNotificationPrefs,
} from "@/lib/parent";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import { useParent } from "@/features/parent/ParentContext";

function Row({ label, value, onChange, disabled }: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

export default function ParentSettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { logout } = useAuth();
  const { children } = useParent();
  const notificationsOn = children.some((c) => c.visibility.notifications);
  const [prefs, setPrefs] = useState<ParentNotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!notificationsOn) return;
    api<ParentNotificationPrefs>("/parent/notifications/preferences")
      .then(setPrefs)
      .catch(() => setPrefs(null));
  }, [notificationsOn]);

  const save = useCallback(
    async (patch: Partial<ParentNotificationPrefs>) => {
      if (!prefs) return;
      const before = prefs;
      setPrefs({ ...before, ...patch });
      setSaving(true);
      try {
        setPrefs(
          await api<ParentNotificationPrefs>("/parent/notifications/preferences", {
            method: "PUT",
            body: patch,
          }),
        );
      } catch (err) {
        setPrefs(before);
        toast.error(userMessage(err, "Could not save"));
      } finally {
        setSaving(false);
      }
    },
    [prefs, toast],
  );

  return (
    <Screen title="Settings">
      <Card>
        <CardHeader>
          <CardTitle>Your children</CardTitle>
          <CardDescription>Children the school has linked to your account.</CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 10 }}>
          {children.length === 0 ? <Text variant="muted">None yet.</Text> : null}
          {children.map((c) => (
            <View key={c.id}>
              <Text weight="500">{personName(c, "Child")}</Text>
              <Text variant="muted" size="xs">
                {[c.school.name, relationshipText(c.relationship, c.relationshipLabel)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
          <Button variant="outline" onPress={() => router.push("/parent-link")}>
            Link another child with a code
          </Button>
        </CardContent>
      </Card>

      {notificationsOn && prefs ? (
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Both are off until you turn them on.</CardDescription>
          </CardHeader>
          <CardContent style={{ gap: 12 }}>
            <Row label="Email" value={prefs.emailEnabled} disabled={saving} onChange={(on) => void save({ emailEnabled: on })} />
            <Row label="Push" value={prefs.pushEnabled} disabled={saving} onChange={(on) => void save({ pushEnabled: on })} />
            <Text variant="label">Tell me about</Text>
            {NOTICE_KINDS.map((k) => (
              <Row
                key={k}
                label={NOTICE_LABELS[k]}
                value={prefs.kinds.includes(k)}
                disabled={saving}
                onChange={(on) => void save({ kinds: toggleNoticeKind(prefs.kinds, k, on) })}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Button variant="destructive" onPress={() => void logout()}>
        Log out
      </Button>
    </Screen>
  );
}
