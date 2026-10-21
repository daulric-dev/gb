import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Clock, MapPin, ScanLine } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import {
  currentLocation,
  formatCountdown,
  useRemaining,
  type LocationFix as Fix,
  type PortalOpenAttendance,
} from "@/lib/attendance";
import { CheckedInCard } from "@/features/attendance/CheckedInCard";

const CODE_LENGTH = 4;

export default function CheckInScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { colors, clay } = useTheme();

  const [session, setSession] = useState<PortalOpenAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Too many wrong codes, or closed under us: no more attempts. */
  const [locked, setLocked] = useState(false);
  const [closed, setClosed] = useState(false);
  const inputRef = useRef<TextInput>(null);
  /** A location reading started as soon as we know one is needed. */
  const fix = useRef<Promise<Fix> | null>(null);

  const load = useCallback(async () => {
    const open = await api<PortalOpenAttendance[]>(
      "/portal/me/attendance/open",
    ).catch(() => null);
    const found = open?.find((s) => s.sessionId === sessionId) ?? null;
    setSession(found);
    if (open && !found) setClosed(true);
  }, [sessionId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Warm the GPS up while they type the code, so submitting is instant.
  const needsLocation = !!session?.requiresLocation && !session.myStatus;
  useEffect(() => {
    if (needsLocation && !fix.current) {
      fix.current = currentLocation();
      fix.current.catch(() => {
        fix.current = null;
      });
    }
  }, [needsLocation]);

  const remaining = useRemaining(session?.closesAt);
  const expired = !!session && remaining <= 0;

  const submit = useCallback(
    async (entered: string) => {
      if (!session || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        let location: Fix | undefined;
        if (session.requiresLocation) {
          if (!fix.current) fix.current = currentLocation();
          try {
            location = await fix.current;
          } catch (err) {
            fix.current = null;
            throw err;
          }
        }
        const result = await api<PortalOpenAttendance>(
          `/portal/me/attendance/${session.sessionId}/check-in`,
          {
            method: "POST",
            body: {
              code: session.requiresCode ? entered : undefined,
              location,
            },
          },
        );
        setSession(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn't check you in";
        setError(message);
        if (err instanceof ApiError) {
          if (err.status === 429) setLocked(true);
          if (err.status === 409 && /closed/i.test(err.message)) {
            setClosed(true);
          } else if (err.status === 409 && /already/i.test(err.message)) {
            // Checked in from another device; show what the server has.
            void load();
          }
        }
        setCode("");
        setTimeout(() => inputRef.current?.focus(), 50);
      } finally {
        setSubmitting(false);
      }
    },
    [session, submitting, load],
  );

  function onChangeCode(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) void submit(digits);
  }

  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/(portal)");

  if (loading) {
    return (
      <Screen title="Check in" onBack={back}>
        <Skeleton style={{ height: 260 }} />
      </Screen>
    );
  }

  if (session?.myStatus) {
    return (
      <Screen title="Checked in" description={session.courseName} onBack={back}>
        <CheckedInCard status={session.myStatus} onDone={back} />
      </Screen>
    );
  }

  if (!session || closed || expired) {
    return (
      <Screen
        title="Attendance has closed"
        description={session?.courseName}
        onBack={back}
      >
        <Card>
          <CardContent style={styles.center}>
            <Clock color={colors.mutedForeground} size={56} />
            <Text variant="muted" style={{ textAlign: "center" }}>
              This check-in is no longer open. Speak to your teacher if you
              were in class.
            </Text>
            <Button variant="outline" onPress={back}>
              Back
            </Button>
          </CardContent>
        </Card>
      </Screen>
    );
  }

  const digits = code.split("");

  return (
    <Screen
      title={session.courseName}
      description={session.title ?? "Attendance"}
      onBack={back}
    >
      <Card>
        <CardContent style={styles.center}>
          <Text variant="muted">Closes in</Text>
          <Text style={styles.countdown}>{formatCountdown(remaining)}</Text>

          {session.requiresCode ? (
            <>
              <Text variant="label" style={{ marginTop: 8 }}>
                Enter the code on the board
              </Text>
              <Pressable
                style={styles.codeRow}
                onPress={() => inputRef.current?.focus()}
                disabled={locked || submitting}
              >
                {Array.from({ length: CODE_LENGTH }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.slot,
                      {
                        backgroundColor: colors.background,
                        borderRadius: clay.radius.md,
                        boxShadow: clay.inset,
                        borderColor: error
                          ? colors.destructive
                          : i === code.length
                            ? colors.ring
                            : "transparent",
                        opacity: locked ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.digit}>{digits[i] ?? ""}</Text>
                  </View>
                ))}
                <TextInput
                  ref={inputRef}
                  value={code}
                  onChangeText={onChangeCode}
                  keyboardType="number-pad"
                  maxLength={CODE_LENGTH}
                  autoFocus
                  editable={!locked && !submitting}
                  style={styles.hidden}
                />
              </Pressable>
            </>
          ) : (
            <Button
              size="lg"
              loading={submitting}
              onPress={() => void submit("")}
              style={{ alignSelf: "stretch", marginTop: 8 }}
            >
              Check in
            </Button>
          )}

          {session.requiresLocation && (
            <View style={styles.hint}>
              <MapPin color={colors.mutedForeground} size={14} />
              <Text variant="muted" size="xs">
                Your location is checked once to confirm you are in class.
              </Text>
            </View>
          )}

          {submitting && session.requiresCode && (
            <Text variant="muted" size="sm">
              Checking you in…
            </Text>
          )}

          {error && (
            <Text tone="destructive" size="sm" style={{ textAlign: "center" }}>
              {error}
            </Text>
          )}

          {error && !locked && !session.requiresCode && (
            <Button variant="outline" onPress={() => void submit("")}>
              Try again
            </Button>
          )}

          <Button
            variant="ghost"
            icon={<ScanLine color={colors.foreground} size={18} />}
            onPress={() => router.push("/attendance/scan")}
            disabled={submitting}
          >
            Scan QR instead
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 12, paddingVertical: 12 },
  countdown: {
    fontSize: 44,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  codeRow: { flexDirection: "row", gap: 12, justifyContent: "center" },
  slot: {
    width: 60,
    height: 72,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: { fontSize: 32, fontWeight: "700" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
  hint: { flexDirection: "row", alignItems: "center", gap: 6 },
});
