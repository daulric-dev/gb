import { useCallback, useEffect, useState } from "react";
import QRCode from "react-native-qrcode-svg";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { api, ApiError } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import {
  formatCountdown,
  STATUS_LABEL,
  useRemaining,
  type AttendanceQrFrame,
  type AttendanceSession,
  type AttendanceSessionDetail,
} from "@/lib/attendance";

const POLL_MS = 5_000;
/** Fetch the next QR frame just after the current one rotates. */
const QR_LEAD_MS = 150;
const QR_RETRY_MS = 3_000;
const QR_SIZE = 220;
const RADIUS_M = 100;
const DURATIONS = ["2", "5", "10", "15"] as const;
type Duration = (typeof DURATIONS)[number];

/**
 * Staff quick action: open a self check-in window for one course and watch
 * the roster fill in. Everything else about attendance lives on the web.
 */
export default function TakeAttendanceScreen() {
  const router = useRouter();
  const toast = useToast();
  const { courseId, name } = useLocalSearchParams<{
    courseId: string;
    name?: string;
  }>();
  const base = `/courses/${courseId}/attendance/sessions`;

  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<AttendanceSessionDetail | null>(null);
  const [duration, setDuration] = useState<Duration>("5");
  const [requireCode, setRequireCode] = useState(true);
  const [useLocation, setUseLocation] = useState(false);
  const [working, setWorking] = useState(false);

  // Resume a window that is already open rather than starting a second one.
  useEffect(() => {
    let cancelled = false;
    api<AttendanceSession[]>(base)
      .then(async (sessions) => {
        const open = sessions.find((s) => s.isOpen);
        if (!open || cancelled) return;
        const detail = await api<AttendanceSessionDetail>(`${base}/${open.id}`);
        if (!cancelled) setSession(detail);
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [base]);

  const sessionId = session?.id;
  const isOpen = !!session?.isOpen;
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const detail = await api<AttendanceSessionDetail>(
      `${base}/${sessionId}`,
    ).catch(() => null);
    if (detail) setSession(detail);
  }, [base, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [isOpen, refresh]);

  async function start() {
    setWorking(true);
    try {
      let location: { latitude: number; longitude: number; radiusM: number } | undefined;
      if (useLocation) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          toast.error("Allow location to use the location check");
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        location = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          radiusM: RADIUS_M,
        };
      }
      const detail = await api<AttendanceSessionDetail>(base, {
        method: "POST",
        body: {
          durationMinutes: Number(duration),
          requireCode,
          location,
        },
      });
      setSession(detail);
    } catch (err) {
      toast.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Couldn't open attendance",
      );
    } finally {
      setWorking(false);
    }
  }

  async function close() {
    if (!session) return;
    setWorking(true);
    try {
      const detail = await api<AttendanceSessionDetail>(
        `${base}/${session.id}/close`,
        { method: "POST" },
      );
      setSession(detail);
      toast.success("Attendance closed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't close");
    } finally {
      setWorking(false);
    }
  }

  const back = () =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)");
  const title = name || "Take attendance";

  if (checking) {
    return (
      <Screen title={title} onBack={back}>
        <Skeleton style={{ height: 240 }} />
      </Screen>
    );
  }

  if (session) {
    return (
      <LiveSession
        title={title}
        session={session}
        working={working}
        onBack={back}
        onClose={close}
        onRefresh={refresh}
      />
    );
  }

  return (
    <Screen title={title} description="Take attendance" onBack={back}>
      <Card>
        <CardContent style={{ gap: 18, paddingTop: 16 }}>
          <View style={{ gap: 8 }}>
            <Text variant="label">Open for (minutes)</Text>
            <SegmentedControl
              options={DURATIONS.map((d) => ({ value: d, label: d }))}
              value={duration}
              onChange={setDuration}
            />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text variant="label">Require a room code</Text>
              <Text variant="muted" size="xs">
                Students type the 4-digit code you show.
              </Text>
            </View>
            <Switch value={requireCode} onValueChange={setRequireCode} />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text variant="label">Check location</Text>
              <Text variant="muted" size="xs">
                Students must be within {RADIUS_M} m of this phone.
              </Text>
            </View>
            <Switch value={useLocation} onValueChange={setUseLocation} />
          </View>
          <Button size="lg" loading={working} onPress={start}>
            Start attendance
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}

function LiveSession({
  title,
  session,
  working,
  onBack,
  onClose,
  onRefresh,
}: {
  title: string;
  session: AttendanceSessionDetail;
  working: boolean;
  onBack: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const remaining = useRemaining(session.isOpen ? session.closesAt : null);
  const [refreshing, setRefreshing] = useState(false);

  // The server finalises an expired session on the next read.
  useEffect(() => {
    if (session.isOpen && remaining <= 0) void onRefresh();
  }, [session.isOpen, remaining, onRefresh]);

  const { present, late } = session.counts;
  const checkedIn = present + late;
  const sorted = [...session.roster].sort((a, b) => {
    if (!!a.status !== !!b.status) return a.status ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  });

  return (
    <Screen
      title={title}
      description={session.isOpen ? "Attendance is open" : "Attendance closed"}
      onBack={onBack}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void onRefresh().finally(() => setRefreshing(false));
      }}
    >
      <Card>
        <CardContent style={styles.live}>
          {session.isOpen ? (
            <RotatingQr
              courseId={session.courseId}
              sessionId={session.id}
              onClosed={onRefresh}
            />
          ) : null}
          {session.isOpen && session.checkInCode ? (
            <>
              <Text variant="muted">Code</Text>
              <Text style={styles.code} selectable>
                {session.checkInCode}
              </Text>
            </>
          ) : null}
          {session.isOpen ? (
            <Text style={styles.countdown}>{formatCountdown(remaining)}</Text>
          ) : null}
          <Text variant="subtitle">
            {checkedIn} / {session.roster.length} checked in
          </Text>
          {session.isOpen ? (
            <Button
              variant="destructive"
              loading={working}
              onPress={onClose}
              style={{ alignSelf: "stretch" }}
            >
              Close attendance
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
        </CardHeader>
        <CardContent style={{ gap: 6 }}>
          {sorted.length === 0 ? (
            <Text variant="muted" size="sm">
              No students in this course.
            </Text>
          ) : (
            sorted.map((r) => (
              <View
                key={r.studentId}
                style={[styles.rosterRow, { borderColor: colors.border }]}
              >
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {displayName(r)}
                </Text>
                {r.method === "qr" ? <Badge variant="outline">QR</Badge> : null}
                {r.status ? (
                  <Badge variant={r.status === "absent" ? "outline" : "secondary"}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                ) : (
                  <Text variant="muted" size="xs">
                    {r.hasAccount ? "Waiting" : "No account"}
                  </Text>
                )}
              </View>
            ))
          )}
        </CardContent>
      </Card>
    </Screen>
  );
}

/**
 * The rotating check-in QR. Each frame is valid for one window (plus the one
 * before it), so a new frame is fetched as soon as `rotatesAt` passes.
 */
function RotatingQr({
  courseId,
  sessionId,
  onClosed,
}: {
  courseId: string;
  sessionId: string;
  onClosed: () => Promise<void>;
}) {
  const [frame, setFrame] = useState<AttendanceQrFrame | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const url = `/courses/${courseId}/attendance/sessions/${sessionId}/qr`;

    async function tick() {
      try {
        const next = await api<AttendanceQrFrame>(url);
        if (stopped) return;
        setFrame(next);
        setFailed(false);
        const wait = new Date(next.rotatesAt).getTime() - Date.now();
        // Guard against clock skew: never spin faster than once a second.
        timer = setTimeout(tick, Math.max(1_000, wait + QR_LEAD_MS));
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 409) {
          // Closed: stop rotating and let the parent pick up the new state.
          stopped = true;
          setFrame(null);
          void onClosed();
          return;
        }
        setFailed(true);
        timer = setTimeout(tick, QR_RETRY_MS);
      }
    }

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [courseId, sessionId, onClosed]);

  return (
    <View style={styles.qrBox}>
      {frame ? (
        <QRCode
          value={frame.url}
          size={QR_SIZE}
          color="#000000"
          backgroundColor="#ffffff"
          quietZone={16}
          ecl="M"
        />
      ) : (
        <View style={{ width: QR_SIZE + 32, height: QR_SIZE + 32 }} />
      )}
      <Text variant="muted" size="xs">
        {failed
          ? "Reconnecting…"
          : `Scan to check in · changes every ${Math.round((frame?.windowMs ?? 15_000) / 1000)} s`}
      </Text>
    </View>
  );
}

function displayName(r: { firstName: string | null; lastName: string | null }) {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "Student";
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  live: { alignItems: "center", gap: 10, paddingVertical: 16 },
  code: {
    fontSize: 88,
    fontWeight: "800",
    letterSpacing: 12,
    fontVariant: ["tabular-nums"],
  },
  countdown: {
    fontSize: 32,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  qrBox: { alignItems: "center", gap: 6, marginBottom: 6 },
  rosterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
