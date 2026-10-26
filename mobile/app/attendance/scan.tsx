import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Camera,
  Clock,
  Flashlight,
  FlashlightOff,
  QrCode,
} from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import {
  currentLocation,
  isQrToken,
  isSessionId,
  parseAttendanceQr,
  type LocationFix,
  type PortalOpenAttendance,
} from "@/lib/attendance";
import { CheckedInCard } from "@/features/attendance/CheckedInCard";
import { parseJoinQr } from "@/lib/course-join";

const HINT_MS = 2_500;
const VIEWFINDER = 240;

type Phase =
  | { kind: "scanning" }
  | { kind: "submitting"; label?: string }
  | { kind: "done"; session: PortalOpenAttendance }
  | { kind: "closed" }
  | { kind: "error"; message: string; title?: string };

/**
 * Student QR check-in. Reads the rotating code on the teacher's screen, which
 * encodes `<web origin>/scan?s=<sessionId>&t=<token>` (older frames used
 * `/portal/attendance/scan`; both are accepted).
 * Opened with `s` and `t` already set (a deep link), it skips the camera.
 */
export default function ScanAttendanceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ s?: string; t?: string }>();
  const linked =
    isSessionId(params.s) && isQrToken(params.t)
      ? { sessionId: params.s, token: params.t }
      : null;

  const [phase, setPhase] = useState<Phase>(
    linked ? { kind: "submitting" } : { kind: "scanning" },
  );
  /** Set once a code is accepted, so one scan submits exactly once. */
  const handled = useRef(false);
  /** A location reading started early when an open session needs one. */
  const fix = useRef<Promise<LocationFix> | null>(null);

  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/(portal)");

  // Warm the GPS up if any open session asks for location, so the scan
  // submits before the 15 s QR window rolls over.
  useEffect(() => {
    let cancelled = false;
    api<PortalOpenAttendance[]>("/portal/me/attendance/open")
      .then((open) => {
        if (cancelled || fix.current) return;
        if (open.some((s) => s.requiresLocation && !s.myStatus)) {
          fix.current = currentLocation();
          fix.current.catch(() => {
            fix.current = null;
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const checkIn = useCallback(async (sessionId: string, token: string) => {
    setPhase({ kind: "submitting" });
    try {
      const open = await api<PortalOpenAttendance[]>(
        "/portal/me/attendance/open",
      );
      const session = open.find((s) => s.sessionId === sessionId);
      if (!session) {
        setPhase({ kind: "closed" });
        return;
      }
      if (session.myStatus) {
        setPhase({ kind: "done", session });
        return;
      }
      let location: LocationFix | undefined;
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
        `/portal/me/attendance/${sessionId}/check-in`,
        { method: "POST", body: { qrToken: token, location } },
      );
      setPhase({ kind: "done", session: result });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (/closed/i.test(err.message)) {
          setPhase({ kind: "closed" });
          return;
        }
        if (/already/i.test(err.message)) {
          // Checked in from another device; show what the server has.
          const open = await api<PortalOpenAttendance[]>(
            "/portal/me/attendance/open",
          ).catch(() => null);
          const mine = open?.find((s) => s.sessionId === sessionId);
          if (mine?.myStatus) {
            setPhase({ kind: "done", session: mine });
            return;
          }
        }
      }
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't check you in",
      });
    }
  }, []);

  // Deep link: both params present, so check in straight away.
  // Keyed on the link itself so a second link opened onto this screen runs too.
  const linkedKey = linked ? `${linked.sessionId}:${linked.token}` : null;
  const lastLinked = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedKey || lastLinked.current === linkedKey) return;
    lastLinked.current = linkedKey;
    handled.current = true;
    const [sessionId, token] = linkedKey.split(":");
    void checkIn(sessionId, token);
  }, [linkedKey, checkIn]);

  const onCode = useCallback(
    (code: { sessionId: string; token: string }) => {
      if (handled.current) return;
      handled.current = true;
      void checkIn(code.sessionId, code.token);
    },
    [checkIn],
  );

  // A course join QR scanned here: enrol and open the course.
  const joinCourse = useCallback(
    async (joinCode: string) => {
      setPhase({ kind: "submitting", label: "Joining the course…" });
      try {
        const course = await api<{ id: string; name: string }>(
          "/portal/me/courses/join",
          { method: "POST", body: { joinCode } },
        );
        router.replace(`/course/${course.id}`);
      } catch (err) {
        setPhase({
          kind: "error",
          title: "Couldn't join the course",
          message:
            err instanceof ApiError && err.status === 404
              ? "This join code doesn't work any more. Your teacher may have turned self-enrolment off or issued a new code."
              : err instanceof Error
                ? err.message
                : "Couldn't join the course",
        });
      }
    },
    [router],
  );

  const onJoin = useCallback(
    (joinCode: string) => {
      if (handled.current) return;
      handled.current = true;
      void joinCourse(joinCode);
    },
    [joinCourse],
  );

  const scanAgain = () => {
    handled.current = false;
    if (params.s || params.t) router.setParams({ s: undefined, t: undefined });
    setPhase({ kind: "scanning" });
  };

  if (phase.kind === "scanning") {
    return <Scanner onCode={onCode} onJoin={onJoin} onBack={back} />;
  }

  if (phase.kind === "submitting") {
    return (
      <Screen title={phase.label ?? "Checking you in…"} onBack={back}>
        <Skeleton style={{ height: 220 }} />
      </Screen>
    );
  }

  if (phase.kind === "done" && phase.session.myStatus) {
    return (
      <Screen
        title="Checked in"
        description={phase.session.courseName}
        onBack={back}
      >
        <CheckedInCard status={phase.session.myStatus} onDone={back} />
      </Screen>
    );
  }

  if (phase.kind === "closed") {
    return (
      <Screen title="Attendance has closed" onBack={back}>
        <Message
          icon="clock"
          text="This check-in is no longer open. Speak to your teacher if you were in class."
          onBack={back}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={
        phase.kind === "error" && phase.title
          ? phase.title
          : "Couldn't check you in"
      }
      onBack={back}
    >
      <Message
        icon="qr"
        text={phase.kind === "error" ? phase.message : "Couldn't check you in"}
        destructive
        onRetry={scanAgain}
        onBack={back}
      />
    </Screen>
  );
}

function Message({
  icon,
  text,
  destructive,
  onRetry,
  onBack,
}: {
  icon: "clock" | "qr";
  text: string;
  destructive?: boolean;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const Icon = icon === "clock" ? Clock : QrCode;
  return (
    <Card>
      <CardContent style={styles.center}>
        <Icon color={colors.mutedForeground} size={56} />
        <Text
          tone={destructive ? "destructive" : undefined}
          variant={destructive ? undefined : "muted"}
          style={{ textAlign: "center" }}
        >
          {text}
        </Text>
        {onRetry ? (
          <Button onPress={onRetry} style={{ alignSelf: "stretch" }}>
            Scan again
          </Button>
        ) : null}
        <Button variant="outline" onPress={onBack}>
          Back
        </Button>
      </CardContent>
    </Card>
  );
}

function Scanner({
  onCode,
  onJoin,
  onBack,
}: {
  onCode: (code: { sessionId: string; token: string }) => void;
  onJoin: (joinCode: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIgnored = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      const code = parseAttendanceQr(data);
      if (code) {
        onCode(code);
        return;
      }
      const joinCode = parseJoinQr(data);
      if (joinCode) {
        onJoin(joinCode);
        return;
      }
      // The camera reports the same code many times a second; only react
      // once per foreign code, and let the hint fade.
      if (lastIgnored.current === data) return;
      lastIgnored.current = data;
      setHint("Not a GradeBook attendance or join code");
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => {
        setHint(null);
        lastIgnored.current = null;
      }, HINT_MS);
    },
    [onCode, onJoin],
  );

  if (!permission) {
    return (
      <Screen title="Scan QR" onBack={onBack}>
        <Skeleton style={{ height: 220 }} />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen title="Scan QR" onBack={onBack}>
        <Card>
          <CardContent style={styles.center}>
            <Camera color={colors.mutedForeground} size={56} />
            <Text variant="muted" style={{ textAlign: "center" }}>
              GradeBook needs the camera to scan the attendance QR code your
              teacher shows. It is only used while this screen is open.
            </Text>
            {permission.canAskAgain ? (
              <Button
                onPress={() => void requestPermission()}
                style={{ alignSelf: "stretch" }}
              >
                Allow camera
              </Button>
            ) : (
              <>
                <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
                  Camera access is turned off. Turn it on for GradeBook in
                  Settings.
                </Text>
                <Button
                  onPress={() => void Linking.openSettings()}
                  style={{ alignSelf: "stretch" }}
                >
                  Open Settings
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      {focused ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
      ) : null}

      {/* Dimmed surround with a clear square in the middle. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.shade, { flex: 1 }]} />
        <View style={{ flexDirection: "row", height: VIEWFINDER }}>
          <View style={[styles.shade, { flex: 1 }]} />
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <View style={[styles.shade, { flex: 1 }]} />
        </View>
        <View style={[styles.shade, { flex: 1 }]} />
      </View>

      <View
        style={[styles.topBar, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [
            styles.round,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <ArrowLeft color="#fff" size={22} />
        </Pressable>
        <Pressable
          onPress={() => setTorch((on) => !on)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={torch ? "Turn torch off" : "Turn torch on"}
          style={({ pressed }) => [
            styles.round,
            torch && { backgroundColor: "#fff" },
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          {torch ? (
            <Flashlight color="#000" size={22} />
          ) : (
            <FlashlightOff color="#fff" size={22} />
          )}
        </Pressable>
      </View>

      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + 32 }]}
        pointerEvents="none"
      >
        <Text weight="600" style={styles.white}>
          Scan the QR code on your teacher's screen
        </Text>
        {hint ? (
          <View style={styles.hintPill}>
            <Text size="sm" style={styles.white}>
              {hint}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const CORNER = 28;
const STROKE = 4;

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 12, paddingVertical: 12 },
  fill: { flex: 1, backgroundColor: "#000" },
  shade: { backgroundColor: "rgba(0,0,0,0.55)" },
  viewfinder: { width: VIEWFINDER, height: VIEWFINDER },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: "#fff",
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: STROKE,
    borderLeftWidth: STROKE,
    borderTopLeftRadius: 12,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: STROKE,
    borderRightWidth: STROKE,
    borderTopRightRadius: 12,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: STROKE,
    borderLeftWidth: STROKE,
    borderBottomLeftRadius: 12,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: STROKE,
    borderRightWidth: STROKE,
    borderBottomRightRadius: 12,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  white: { color: "#fff", textAlign: "center" },
  hintPill: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
