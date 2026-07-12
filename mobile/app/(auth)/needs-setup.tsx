import { useRouter } from "expo-router";
import { View } from "react-native";
import { GraduationCap } from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * The mobile MVP doesn't include the school onboarding/selection flow, so
 * authenticated users without a school are pointed to the web app to finish
 * setup. They can still refresh (in case setup completed) or sign out.
 */
export default function NeedsSetupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { refresh, logout } = useAuth();

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <View style={{ marginBottom: 8 }}>
            <GraduationCap size={32} color={colors.mutedForeground} />
          </View>
          <CardTitle>Finish setting up your account</CardTitle>
          <CardDescription>
            Your account isn&apos;t linked to a school yet. Complete onboarding
            in the GradeBook web app, then come back and refresh.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 12 }}>
          <Button
            onPress={async () => {
              await refresh();
              router.replace("/");
            }}
          >
            I&apos;ve finished — refresh
          </Button>
          <Button
            variant="ghost"
            onPress={async () => {
              await logout();
              router.replace("/(auth)/login");
            }}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
