import { useState } from "react";
import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { formatLinkCode, isCompleteLinkCode } from "@/lib/parent";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Text";

/**
 * Redeem a one-time code from a child's school. Any signed-in account that
 * may become a parent can use it (a new account names itself here); the API
 * refuses staff and student accounts.
 */
export default function ParentLinkScreen() {
  const router = useRouter();
  const { profile, loading, refresh } = useAuth();
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !profile) return <Redirect href="/(auth)/login" />;
  const needsName = !profile?.first_name;

  async function submit() {
    if (!isCompleteLinkCode(code)) {
      setError("Enter the 10-character code from the school");
      return;
    }
    if (needsName && !firstName.trim()) {
      setError("Enter your first name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/parent/link/redeem", {
        method: "POST",
        body: {
          code,
          ...(needsName ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
        },
      });
      await refresh();
      router.replace("/(parent)");
    } catch (err) {
      setError(userMessage(err, "That did not work"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Link your child" description="Enter the one-time code your child's school gave you." onBack={() => router.back()}>
      <Card>
        <CardContent style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Label>Code</Label>
            <Input
              value={code}
              onChangeText={(t) => setCode(formatLinkCode(t))}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCDE-FGHJK"
              accessibilityLabel="Code"
            />
          </View>
          {needsName ? (
            <>
              <View style={{ gap: 6 }}>
                <Label>First name</Label>
                <Input value={firstName} onChangeText={setFirstName} autoComplete="given-name" accessibilityLabel="First name" />
              </View>
              <View style={{ gap: 6 }}>
                <Label>Last name</Label>
                <Input value={lastName} onChangeText={setLastName} autoComplete="family-name" accessibilityLabel="Last name" />
              </View>
            </>
          ) : null}
          {error ? (
            <Text tone="destructive" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button loading={busy} onPress={() => void submit()}>
            Link
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}
