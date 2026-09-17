import { StyleSheet, View } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * Student settings: identity, appearance and sign-out. Deliberately narrower
 * than the staff screen - a student cannot leave a school or change their own
 * record, since the link to it is what the school issued a claim code for.
 */
export default function PortalSettingsScreen() {
  const { profile, logout } = useAuth();
  const { mode, setMode } = useTheme();

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    "Student";

  return (
    <Screen title="Settings">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 10 }}>
          <Row label="Name" value={name} />
          <Row label="Email" value={profile?.email ?? "-"} />
          <Row label="School" value={profile?.school?.name ?? "-"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <SegmentedControl<ThemeMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        </CardContent>
      </Card>

      <Button variant="outline" onPress={logout}>
        Log out
      </Button>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="muted" style={{ fontSize: 13 }}>
        {label}
      </Text>
      <Text weight="500" numberOfLines={1} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  value: { flexShrink: 1, textAlign: "right" },
});
