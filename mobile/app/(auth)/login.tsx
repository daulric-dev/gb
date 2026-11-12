import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, isNetworkError } from "@/lib/api";
import { homeRouteFor } from "@/lib/routing";
import { checkForUpdate, lastKnownStoreUrl, openStore } from "@/lib/app-update";
import {
  discoverSso,
  fetchSsoProviders,
  isSsoRequiredError,
  signInWithSso,
  ssoErrorMessage,
  OUTDATED_APP_MESSAGE,
  type SsoDiscovery,
  type SsoProvider,
} from "@/lib/sso";
import { useAuth } from "@/providers/AuthProvider";
import { useApiServer } from "@/providers/ApiServerProvider";
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
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { userMessage } from "@/lib/errors";
import { openPrivacyNotice } from "@/lib/privacy-link";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email first. The address decides how they sign in: a school that requires
 * its provider goes straight there, one that merely offers it gets the choice,
 * and everyone else gets an emailed code as before.
 */
export default function LoginScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { refresh, logout } = useAuth();
  const { serverUrl, disconnect } = useApiServer();
  const params = useLocalSearchParams<{ ssoError?: string }>();

  const [email, setEmail] = useState("");
  /** What is in flight: "continue", "otp", or a provider id. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The school's provider, when it offers one without requiring it. */
  const [offered, setOffered] = useState<SsoProvider | null>(null);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  // A sign-in that came back through the /sso deep link with an error. The
  // param is a reason code (deep links can set it), mapped to fixed text.
  const [error, setError] = useState<string | null>(
    typeof params.ssoError === "string" ? ssoErrorMessage(params.ssoError) : null,
  );
  const [switchingServer, setSwitchingServer] = useState(false);

  useEffect(() => {
    if (typeof params.ssoError === "string")
      setError(ssoErrorMessage(params.ssoError));
  }, [params.ssoError]);

  useEffect(() => {
    let cancelled = false;
    fetchSsoProviders()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setProviders(list);
      })
      .catch(() => {
        /* no buttons; email codes still work */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = email.trim();

  /** For OUTDATED_APP_MESSAGE: the store page, if the API knows it. */
  async function updateApp() {
    if (!lastKnownStoreUrl()) await checkForUpdate();
    if (!(await openStore(lastKnownStoreUrl())))
      toast.error("Open the App Store or Google Play and update GradeBook.");
  }

  async function startSso(provider: SsoProvider, address?: string) {
    setBusy(provider.id);
    setError(null);
    try {
      const result = await signInWithSso(
        provider.id,
        address && EMAIL_RE.test(address) ? address : undefined,
      );
      if (result.type === "error") {
        setError(result.message);
      } else if (result.type === "mfa") {
        router.push({ pathname: "/(auth)/two-step", params: { token: result.token } } as never);
      } else if (result.type === "success") {
        const profile = await refresh();
        if (!profile) {
          setError("We couldn't finish signing you in. Try again.");
          return;
        }
        router.replace(homeRouteFor(profile));
      }
      // "cancel": they closed the browser; leave the screen as it was.
    } finally {
      setBusy(null);
    }
  }

  async function sendCode(address: string) {
    setBusy("otp");
    setError(null);
    try {
      await api("/auth/otp/send", {
        method: "POST",
        body: { email: address },
      });
      toast.success("OTP sent to your email");
      router.push({
        pathname: "/(auth)/verify",
        params: { email: address },
      });
    } catch (err) {
      // The school turned on "Require single sign-on" since we looked.
      if (isSsoRequiredError(err)) {
        const found = await discoverSso(address).catch(() => null);
        if (found?.provider) {
          setBusy(null);
          await startSso(found.provider, address);
          return;
        }
      }
      setError(userMessage(err, "Failed to send OTP"));
    } finally {
      setBusy(null);
    }
  }

  async function handleContinue() {
    if (!trimmed || busy) return;
    if (offered) {
      await startSso(offered, trimmed);
      return;
    }

    setBusy("continue");
    setError(null);
    let found: SsoDiscovery | null = null;
    try {
      found = await discoverSso(trimmed);
    } catch (err) {
      if (isNetworkError(err)) {
        setError(userMessage(err, "Can't reach the server."));
        setBusy(null);
        return;
      }
      // A malformed address or an older API: fall back to an email code,
      // whose own validation says what is wrong.
    }
    setBusy(null);

    if (found?.provider && found.required) {
      await startSso(found.provider, trimmed);
    } else if (found?.provider) {
      setOffered(found.provider);
    } else {
      await sendCode(trimmed);
    }
  }

  function handleProvider(provider: SsoProvider) {
    if (busy) return;
    // SAML is found by email domain, so it cannot start without one.
    if (provider.kind === "saml" && !EMAIL_RE.test(trimmed)) {
      setError(`Enter your school email first, then choose ${provider.label}.`);
      return;
    }
    void startSso(provider, trimmed);
  }

  async function changeServer() {
    if (switchingServer) return;
    setSwitchingServer(true);
    try {
      await logout();
      await disconnect();
    } catch {
      setError("Couldn't clear the saved server. Please try again.");
    } finally {
      setSwitchingServer(false);
    }
  }

  const others = providers.filter((p) => p.id !== offered?.id);

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Sign in to GradeBook</CardTitle>
          <CardDescription>
            {offered
              ? `Your school signs in with ${offered.label}`
              : "Enter your email to sign in"}
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>Email</Label>
            <Input
              placeholder="teacher@school.com"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (offered) setOffered(null);
                if (error) setError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              autoFocus
              editable={!busy}
              onSubmitEditing={handleContinue}
              returnKeyType="go"
            />
          </View>

          {offered ? (
            <View style={{ gap: 10 }}>
              <Button
                onPress={handleContinue}
                loading={busy === offered.id}
                disabled={!!busy && busy !== offered.id}
              >
                {`Continue with ${offered.label}`}
              </Button>
              <Button
                variant="outline"
                onPress={() => void sendCode(trimmed)}
                loading={busy === "otp"}
                disabled={!!busy && busy !== "otp"}
              >
                Email me a code instead
              </Button>
            </View>
          ) : (
            <Button
              onPress={handleContinue}
              loading={busy === "continue" || busy === "otp"}
              disabled={!trimmed || (!!busy && busy !== "continue" && busy !== "otp")}
            >
              Continue
            </Button>
          )}

          {error ? (
            <Text tone="destructive" size="sm" style={{ textAlign: "center" }}>
              {error}
            </Text>
          ) : null}
          {error === OUTDATED_APP_MESSAGE ? (
            <Button variant="outline" onPress={() => void updateApp()}>
              Update GradeBook
            </Button>
          ) : null}

          {others.length > 0 ? (
            <View style={{ gap: 10 }}>
              <View style={styles.dividerRow}>
                <View
                  style={[styles.dividerLine, { backgroundColor: colors.border }]}
                />
                <Text tone="muted" size="xs">
                  Or continue with
                </Text>
                <View
                  style={[styles.dividerLine, { backgroundColor: colors.border }]}
                />
              </View>
              {others.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  onPress={() => handleProvider(provider)}
                  loading={busy === provider.id}
                  disabled={!!busy && busy !== provider.id}
                >
                  {provider.label}
                </Button>
              ))}
            </View>
          ) : null}

          {offered ? (
            <Pressable
              onPress={() => {
                setOffered(null);
                setEmail("");
                setError(null);
              }}
              disabled={!!busy}
              hitSlop={8}
              style={{ alignSelf: "center" }}
            >
              <Text
                size="sm"
                weight="500"
                style={{ color: colors.foreground, textDecorationLine: "underline" }}
              >
                Use a different email
              </Text>
            </Pressable>
          ) : null}

          <Text
            variant="muted"
            style={{ fontSize: 12, textAlign: "center", marginTop: 4 }}
          >
            By continuing, you agree to the Terms of Service.{" "}
            <Text
              size="xs"
              accessibilityRole="link"
              onPress={openPrivacyNotice}
              style={{ fontSize: 12, textDecorationLine: "underline" }}
            >
              How your data is used (privacy notice)
            </Text>
          </Text>
          {serverUrl ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void changeServer()}
              loading={switchingServer}
              disabled={!!busy}
            >
              Change school server
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
