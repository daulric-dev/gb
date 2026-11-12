import { useState } from "react";
import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { serverHost } from "@/lib/api";
import { enrolmentRequired, webSetupUrl } from "@/lib/mfa";
import { homeRouteFor } from "@/lib/routing";
import { useAuth } from "@/providers/AuthProvider";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

/**
 * The organisation requires an authenticator app for this person's role and
 * they have none: until they set one up (on the web), the session can do
 * nothing else (the API answers 403 MFA_ENROLMENT_REQUIRED).
 */
export default function TwoStepRequiredScreen() {
  const router = useRouter();
  const { refresh, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [stillRequired, setStillRequired] = useState(false);
  const url = webSetupUrl();
  const where = url ?? `the GradeBook web app for ${serverHost()} (Account settings, Two-step verification)`;

  async function check() {
    setChecking(true);
    try {
      if (await enrolmentRequired()) {
        setStillRequired(true);
        return;
      }
      router.replace(homeRouteFor(await refresh()));
    } finally {
      setChecking(false);
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Set up two-step verification</CardTitle>
          <CardDescription>
            Your organisation requires an authenticator app for your role.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View style={{ alignItems: "center" }}>
            <Text size="sm">Sign in on the web at {where} and set one up there, then come back.</Text>
          </View>
          {stillRequired ? (
            <View style={{ alignItems: "center" }}>
              <Text tone="destructive" size="sm">It is not set up yet.</Text>
            </View>
          ) : null}
          <View style={{ gap: 8 }}>
            {url ? (
              <Button variant="outline" onPress={() => void Linking.openURL(url)}>
                Open the web app
              </Button>
            ) : null}
            <Button onPress={() => void check()} loading={checking}>
              I have set it up
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                void logout().then(() => router.replace("/(auth)/login"));
              }}
            >
              Sign out
            </Button>
          </View>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
