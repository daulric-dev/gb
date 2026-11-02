import { useEffect } from "react";
import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { Building2, ExternalLink, LogOut, UserRound } from "lucide-react-native";
import { serverHost } from "@/lib/api";
import { homeRouteFor } from "@/lib/routing";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { AuthShell } from "@/components/auth/AuthShell";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

/** The web app's origin, when the build knows it (no trailing slash). */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/$/, "") || null;

/**
 * Where an organisation admin who belongs to no school lands. The
 * organisation console is web-only, so this just says where to find it.
 */
export default function OrganisationScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile, refresh, logout } = useAuth();

  // Appointed to a school meanwhile (or no longer an admin): move on.
  useEffect(() => {
    if (profile && (profile.school || !profile.is_org_admin)) {
      router.replace(homeRouteFor(profile));
    }
  }, [profile, router]);

  const consoleUrl = WEB_URL ? `${WEB_URL}/organisation` : null;
  const where = consoleUrl ?? `the GradeBook web app for ${serverHost()}`;

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/login");
  }

  return (
    <AuthShell>
      <View style={{ gap: 20 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <Building2 size={36} color={colors.primary} />
          <Text variant="title" style={{ textAlign: "center" }}>
            {profile?.organisation?.name ?? "Your organisation"}
          </Text>
        </View>

        <Card>
          <CardContent style={{ gap: 12 }}>
            <Text>
              Manage your organisation on the web at {where}.
            </Text>
            <Text variant="muted">
              Adding schools, appointing their admins and managing
              administrators is only available there. Once you belong to a
              school, it opens here.
            </Text>
            {consoleUrl && (
              <Button
                variant="outline"
                onPress={() => void Linking.openURL(consoleUrl)}
                icon={<ExternalLink size={16} color={colors.foreground} />}
              >
                Open in browser
              </Button>
            )}
            <Button variant="ghost" onPress={() => void refresh()}>
              Check again
            </Button>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          onPress={() => router.push("/(auth)/account")}
          icon={<UserRound size={16} color={colors.foreground} />}
        >
          Account settings
        </Button>

        <Button
          variant="ghost"
          onPress={handleLogout}
          icon={<LogOut size={16} color={colors.foreground} />}
        >
          Log out
        </Button>
      </View>
    </AuthShell>
  );
}
