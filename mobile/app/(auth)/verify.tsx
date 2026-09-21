import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/providers/ToastProvider";
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
import { OtpInput } from "@/components/ui/OtpInput";
import { Text } from "@/components/ui/Text";

const CODE_LENGTH = 8;
const RESEND_COOLDOWN = 60;

/**
 * Mirrors the web verify screen: one primary action, the two secondary ones as
 * text links, and failures shown against the boxes rather than in a toast.
 *
 * The web version leads with a mail icon. Here the shell already puts the
 * brand mark directly above the card, and a second icon under it just stacks
 * two badges down the middle of a phone screen, so it is left out.
 */
export default function VerifyScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? "";

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
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

  const verify = useCallback(async () => {
    if (code.length !== CODE_LENGTH || loading) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        user: {
          is_onboarded: boolean;
          first_name: string | null;
          account_type: "staff" | "student" | null;
          school: { id: string } | null;
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: { email, token: code },
        skipAuthRedirect: true,
      });
      await refresh();
      const isStudent = data.user.account_type === "student";

      if (data.user.school) {
        router.replace(isStudent ? "/(portal)" : "/(tabs)");
      } else if (data.user.first_name) {
        // Named but school-less: students still owe a claim code, staff still
        // owe a school. Sending either back to onboard would just loop.
        router.replace("/(auth)/schools");
      } else {
        router.replace("/(auth)/onboard");
      }
    } catch (err) {
      // Shown against the boxes rather than only as a toast: a toast slides
      // away, and the next thing they do is retype the code right here.
      setError(
        err instanceof ApiError ? err.message : "Verification failed",
      );
      setCode("");
    } finally {
      setLoading(false);
    }
  }, [code, email, loading, refresh, router]);

  // Submitting is the obvious next step once the last digit lands, so do it
  // rather than making them reach for the button.
  useEffect(() => {
    if (code.length === CODE_LENGTH) void verify();
  }, [code, verify]);

  async function handleResend() {
    setResending(true);
    try {
      await api("/auth/otp/send", { method: "POST", body: { email } });
      toast.success("New code sent to your email");
      setCode("");
      setError(null);
      startCooldown();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to resend code",
      );
    } finally {
      setResending(false);
    }
  }

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
        <CardContent style={{ gap: 20 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              autoFocus
              error={!!error}
              disabled={loading}
            />
            {/* Reserved height, so the layout does not jump when an error
                lands mid-typing. */}
            <View style={{ minHeight: 18, justifyContent: "center" }}>
              {error ? (
                <Text tone="destructive" size="sm" style={{ textAlign: "center" }}>
                  {error}
                </Text>
              ) : null}
            </View>
          </View>

          <Button
            onPress={verify}
            loading={loading}
            disabled={code.length !== CODE_LENGTH}
          >
            {loading ? "Verifying" : "Verify"}
          </Button>

          <View style={{ alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text tone="muted" size="sm">
                Didn&apos;t get it?
              </Text>
              <Pressable
                onPress={handleResend}
                disabled={resending || cooldown > 0}
                hitSlop={8}
              >
                <Text
                  size="sm"
                  weight="500"
                  style={{
                    color: colors.foreground,
                    opacity: resending || cooldown > 0 ? 0.6 : 1,
                    textDecorationLine:
                      resending || cooldown > 0 ? "none" : "underline",
                  }}
                >
                  {resending
                    ? "Sending…"
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Resend code"}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => router.replace("/(auth)/login")}
              hitSlop={8}
            >
              <Text
                tone="muted"
                size="sm"
                style={{ textDecorationLine: "underline" }}
              >
                Use a different email
              </Text>
            </Pressable>
          </View>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
