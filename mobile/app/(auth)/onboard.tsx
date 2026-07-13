import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
import { AuthShell } from "@/components/auth/AuthShell";
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

export default function OnboardScreen() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Enter your first and last name");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/onboard", {
        method: "PATCH",
        body: { firstName: firstName.trim(), lastName: lastName.trim() },
        skipAuthRedirect: true,
      });
      await refresh();
      router.replace("/(auth)/schools");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Onboarding failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Complete your profile</CardTitle>
          <CardDescription>
            Tell us a bit about yourself to get started
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>First name</Label>
            <Input
              placeholder="John"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoFocus
              returnKeyType="next"
            />
          </View>
          <View>
            <Label>Last name</Label>
            <Input
              placeholder="Doe"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>
          <Button onPress={handleSubmit} loading={loading}>
            Continue
          </Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
