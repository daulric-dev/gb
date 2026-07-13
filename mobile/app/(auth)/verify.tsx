import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { Button } from "@/components/ui/Button";
import { OtpInput } from "@/components/ui/OtpInput";
import { Text } from "@/components/ui/Text";

const CODE_LENGTH = 8;
const RESEND_COOLDOWN = 60;

export default function VerifyScreen() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? "";

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!email) router.replace("/(auth)/login");
  }, [email, router]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleSubmit() {
    if (code.length !== CODE_LENGTH) return;
    setLoading(true);
    try {
      const data = await api<{
        user: {
          is_onboarded: boolean;
          first_name: string | null;
          school: { id: string } | null;
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { email, token: code },
        skipAuthRedirect: true,
      });
      await refresh();
      if (data.user.school) {
        router.replace("/(tabs)");
      } else if (data.user.first_name) {
        router.replace("/(auth)/schools");
      } else {
        router.replace("/(auth)/onboard");
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Verification failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await api("/auth/otp/send", { method: "POST", body: { email } });
      toast.success("New code sent to your email");
      setCode("");
      startCooldown();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to resend code",
      );
    } finally {
      setResending(false);
    }
  }

  // Auto-submit once all digits are entered.
  useEffect(() => {
    if (code.length === CODE_LENGTH && !loading) {
      void handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Enter your code</CardTitle>
          <CardDescription>We sent an 8-digit code to</CardDescription>
          <Text weight="600" style={{ marginTop: 2 }}>
            {email}
          </Text>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View style={{ alignItems: "center", paddingVertical: 4 }}>
            <OtpInput value={code} onChange={setCode} autoFocus />
          </View>
          <Button
            onPress={handleSubmit}
            loading={loading}
            disabled={code.length !== CODE_LENGTH}
          >
            Verify
          </Button>
          <Button
            variant="ghost"
            onPress={handleResend}
            loading={resending}
            disabled={cooldown > 0}
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </Button>
          <Button
            variant="ghost"
            onPress={() => router.replace("/(auth)/login")}
          >
            Back to login
          </Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
