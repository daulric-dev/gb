import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { GraduationCap, LogOut } from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getInitials, capitalize } from "@/lib/utils";

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { profile, logout } = useAuth();
  const { colors, mode, setMode } = useTheme();

  const displayName =
    profile?.first_name || profile?.last_name
      ? `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim()
      : (profile?.email ?? "User");

  async function handleLogout() {
    await logout();
    toast.success("Logged out");
    router.replace("/(auth)/login");
  }

  return (
    <Screen title="Settings" description="Manage your account">
      <Card>
        <CardContent style={styles.profileRow}>
          <Avatar
            uri={profile?.avatar_url}
            fallback={getInitials(profile?.first_name, profile?.last_name)}
            size={56}
          />
          <View style={{ flex: 1 }}>
            <Text weight="600" style={{ fontSize: 16 }} numberOfLines={1}>
              {displayName}
            </Text>
            {profile?.email ? (
              <Text variant="muted" numberOfLines={1}>
                {profile.email}
              </Text>
            ) : null}
            {profile?.role ? (
              <Text variant="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {capitalize(profile.role)}
              </Text>
            ) : null}
          </View>
        </CardContent>
      </Card>

      {profile?.school?.name ? (
        <Card>
          <CardContent style={styles.schoolRow}>
            <GraduationCap size={18} color={colors.mutedForeground} />
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {profile.school.name}
            </Text>
          </CardContent>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <Text variant="label">Appearance</Text>
        <SegmentedControl<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </View>

      <Button
        variant="outline"
        onPress={handleLogout}
        icon={<LogOut size={16} color={colors.foreground} />}
      >
        Log out
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  schoolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
});
