import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

/** Codes are issued as 12 characters shown in three groups: RXKT-9WMB-2FQH. */
const CODE_LENGTH = 12;

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Re-group as the user types so the field mirrors the printed code. */
function format(value: string) {
  const clean = normalize(value).slice(0, CODE_LENGTH);
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

export function ClaimCodeForm({
  mode = "school",
}: {
  /** `school` joins by the school-wide code; `student` links an existing record. */
  mode?: "school" | "student";
}) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const ready = normalize(code).length === CODE_LENGTH;

  async function handleSubmit() {
    if (!ready) {
      toast.error("Enter the full claim code");
      return;
    }
    setLoading(true);
    try {
      await api(mode === "school" ? "/auth/join-school" : "/auth/claim-student", {
        method: "POST",
        body: { code },
        skipAuthRedirect: true,
      });
      // The claim sets school and account type server-side, so the cached
      // profile is stale until this resolves.
      await refresh();
      toast.success("Account linked");
      router.replace("/(portal)");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not redeem that code",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Enter your join code</CardTitle>
          <CardDescription>
            {mode === "school"
              ? "Your school gives you a code that lets you join it."
              : "Your school gives you a code that links this login to your student record."}
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>Join code</Label>
            <Input
              placeholder="RXKT-9WMB-2FQH"
              value={code}
              onChangeText={(value) => setCode(format(value))}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              autoFocus
              style={{ textAlign: "center", letterSpacing: 2 }}
            />
            <Text variant="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Dashes and letter case do not matter.
            </Text>
          </View>
          <Button onPress={handleSubmit} loading={loading} disabled={!ready}>
            Join school
          </Button>
          <Text
            variant="muted"
            style={{ fontSize: 12, textAlign: "center" }}
          >
            Do not have a code? Ask a teacher or the school office to issue one.
          </Text>
        </CardContent>
    </Card>
  );
}
