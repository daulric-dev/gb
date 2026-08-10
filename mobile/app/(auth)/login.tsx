import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError } from "@/lib/api";
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
import { Text } from "@/components/ui/Text";

export default function LoginScreen() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await api("/auth/otp/send", {
        method: "POST",
        body: { email: trimmed },
      });
      toast.success("OTP sent to your email");
      router.push({
        pathname: "/(auth)/verify",
        params: { email: trimmed },
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Sign in to GradeBook</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a one-time code
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>Email</Label>
            <Input
              placeholder="teacher@school.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              autoFocus
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
            />
          </View>
          <Button onPress={handleSubmit} loading={loading}>
            Send OTP
          </Button>
          <Text
            variant="muted"
            style={{ fontSize: 12, textAlign: "center", marginTop: 4 }}
          >
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
