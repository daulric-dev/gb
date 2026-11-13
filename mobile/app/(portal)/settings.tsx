import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SignedInDevices } from "@/features/account/SignedInDevices";
import { CheckForUpdates } from "@/features/app-update/CheckForUpdates";
import { OfflineDataCard } from "@/features/offline/OfflineDataCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { offlineUsage } from "@/lib/offline-store";
import { openDataDownload, openPrivacyNotice } from "@/lib/privacy-link";
import { NotificationPreferencesCard } from "@/features/notifications/NotificationPreferencesCard";

/**
 * Student settings: identity, appearance, signed-in devices and sign-out. Deliberately narrower
 * than the staff screen - a student cannot leave a school or change their own
 * record, since it was created when they joined with the school code.
 */
export default function PortalSettingsScreen() {
  const { profile, logout, refresh } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState<number | null>(null);

  // Logging out deletes offline data, including drafts never sent.
  const onLogout = useCallback(() => {
    const unsent = offlineUsage().unsentDrafts;
    if (unsent > 0) setConfirmLogout(unsent);
    else void logout();
  }, [logout]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    void Promise.resolve(refresh()).finally(() => setRefreshing(false));
  }, [refresh]);
  const { mode, setMode } = useTheme();

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    "Student";

  return (
    <Screen
      title="Settings"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 10 }}>
          <Row label="Name" value={name} />
          <Row label="Email" value={profile?.email ?? "-"} />
          <Row label="School" value={profile?.school?.name ?? "-"} />
          {profile?.organisation?.name ? (
            <Row label="Organisation" value={profile.organisation.name} />
          ) : null}
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

      <SignedInDevices refreshKey={refreshKey} />

      <NotificationPreferencesCard refreshKey={refreshKey} />

      <OfflineDataCard refreshKey={refreshKey} />

      <CheckForUpdates />

      <Button variant="ghost" onPress={openPrivacyNotice}>
        Privacy notice
      </Button>

      {/* Asked for and downloaded on the web: it needs "Confirm it's you". */}
      <Button variant="ghost" onPress={() => openDataDownload("student")}>
        Download my data (opens the website)
      </Button>

      <Button variant="outline" onPress={onLogout}>
        Log out
      </Button>
      <ConfirmDialog
        open={confirmLogout !== null}
        title="Delete unsent drafts?"
        message={`${confirmLogout} ${confirmLogout === 1 ? "draft is" : "drafts are"} saved only on this device and haven't reached the server. Logging out deletes ${confirmLogout === 1 ? "it" : "them"}. Open your work while online to send or hand in first.`}
        confirmLabel="Log out anyway"
        cancelLabel="Keep my drafts"
        destructive
        onConfirm={() => {
          setConfirmLogout(null);
          void logout();
        }}
        onCancel={() => setConfirmLogout(null)}
      />
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
