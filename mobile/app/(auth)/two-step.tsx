import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { homeRouteFor } from "@/lib/routing";
import {
  enrolmentRequired,
  FINAL_MFA_ERRORS,
  MFA_CODE_LENGTH,
  verifyMfaChallenge,
} from "@/lib/mfa";
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
import { Input } from "@/components/ui/Input";
import { OtpInput } from "@/components/ui/OtpInput";
import { Text } from "@/components/ui/Text";

/**
 * The second sign-in step for accounts with an authenticator app, after the
 * emailed code or single sign-on answered 403 MFA_REQUIRED. The challenge
 * token comes as a route param; it lasts five minutes and works once.
 */
export default function TwoStepScreen() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = params.token ?? "";

  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!token) router.replace("/(auth)/login");
  }, [token, router]);

  const submit = useCallback(
    async (value: string) => {
      if (submitting.current || finished || !token) return;
      if (!useRecovery && value.length !== MFA_CODE_LENGTH) return;
      submitting.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await verifyMfaChallenge(
          useRecovery ? { token, recoveryCode: value.trim() } : { token, code: value },
        );
        if (res.recoveryCodeUsed) {
          toast.success(
            `Signed in with a recovery code. ${res.recoveryCodesRemaining} left: make new ones on the web.`,
          );
        }
        const profile = await refresh();
        if (await enrolmentRequired()) {
          router.replace("/(auth)/two-step-required");
          return;
        }
        router.replace(homeRouteFor(profile));
      } catch (err) {
        setError(userMessage(err, "That code did not work"));
        if (err instanceof ApiError && err.code && FINAL_MFA_ERRORS.has(err.code)) setFinished(true);
        setCode("");
      } finally {
        submitting.current = false;
        setLoading(false);
      }
    },
    [finished, token, useRecovery, toast, refresh, router],
  );

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Two-step verification</CardTitle>
          <CardDescription style={{ textAlign: "center" }}>
            {useRecovery
              ? "Enter one of your recovery codes. Each works once."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 20 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            {useRecovery ? (
              <Input
                value={recoveryCode}
                onChangeText={(v) => {
                  setRecoveryCode(v);
                  if (error && !finished) setError(null);
                }}
                placeholder="xxxxx-xxxxx"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                editable={!loading && !finished}
                accessibilityLabel="Recovery code"
                style={{ alignSelf: "stretch" }}
              />
            ) : (
              <OtpInput
                length={MFA_CODE_LENGTH}
                value={code}
                onChange={(v) => {
                  const digits = v.replace(/\D/g, "").slice(0, MFA_CODE_LENGTH);
                  setCode(digits);
                  if (error && !finished) setError(null);
                  if (digits.length === MFA_CODE_LENGTH) void submit(digits);
                }}
                autoFocus
                error={!!error}
                disabled={loading || finished}
              />
            )}
            <View style={{ minHeight: 18, justifyContent: "center" }}>
              {error ? (
                <Text tone="destructive" size="sm" style={{ textAlign: "center" }}>
                  {error}
                </Text>
              ) : null}
            </View>
          </View>

          {finished ? (
            <Button onPress={() => router.replace("/(auth)/login")}>Start again</Button>
          ) : (
            <Button
              onPress={() => void submit(useRecovery ? recoveryCode : code)}
              loading={loading}
              disabled={
                useRecovery ? recoveryCode.trim().length < 10 : code.length !== MFA_CODE_LENGTH
              }
            >
              {loading ? "Verifying" : "Verify"}
            </Button>
          )}

          <View style={{ alignItems: "center", gap: 8 }}>
            {!finished && (
              <Pressable
                onPress={() => {
                  setUseRecovery((r) => !r);
                  setError(null);
                }}
                hitSlop={8}
              >
                <Text tone="muted" size="sm" style={{ textDecorationLine: "underline" }}>
                  {useRecovery ? "Use a code from the app" : "Lost your phone? Use a recovery code"}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.replace("/(auth)/login")} hitSlop={8}>
              <Text tone="muted" size="sm" style={{ textDecorationLine: "underline" }}>
                Cancel
              </Text>
            </Pressable>
            <Text tone="muted" size="sm" style={{ textAlign: "center" }}>
              No phone and no recovery codes? Ask your organisation&apos;s administrator to reset
              two-step verification on your account.
            </Text>
          </View>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
