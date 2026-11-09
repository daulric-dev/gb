import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  addDays,
  dayLabel,
  localToday,
  occurrencePath,
  phase,
  type TimetableOccurrence,
  type TimetableRange,
} from "@/lib/timetable";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { withFeature } from "@/components/layout/FeatureGate";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { OccurrenceRow } from "@/features/timetable/OccurrenceRow";

type Pending = { occurrence: TimetableOccurrence; action: "cancel" | "restore" };

/** What the automatic session did for this period, for the badge. */
function sessionBadge(o: TimetableOccurrence, now: number): string | null {
  if (o.status === "cancelled") return null;
  if (o.session?.state === "skipped") return "Not opened";
  if (o.session?.state === "opened") {
    if (!o.session.id) return "Session deleted";
    return phase(o, now) === "now" ? "Check-in open" : "Session closed";
  }
  return phase(o, now) === "upcoming" ? "Opens automatically" : null;
}

/**
 * A member of staff's periods for a day (today by default): check-in opens
 * automatically at each period. Cancel or restore a period here; moving one
 * to another time or room is on the web course timetable.
 */
function TodayScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [day, setDay] = useState<string | null>(null);
  const [data, setData] = useState<TimetableRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // Without a day the server answers with the school's today.
    const qs = day ? `?from=${day}&to=${day}` : "";
    return api<TimetableRange>(`/timetable/me${qs}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(userMessage(err, "Could not load your timetable.")));
  }, [day]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const shown = day ?? data?.from ?? localToday();
  const today = data?.today ?? localToday();
  const now = Date.now();
  const list = (data?.occurrences ?? []).filter((o) => o.date === shown);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const { occurrence: o, action } = pending;
    try {
      if (action === "cancel") {
        await api(occurrencePath(o), { method: "PUT", body: { kind: "cancel" } });
        toast.success(`${o.courseName} cancelled`);
      } else {
        await api(occurrencePath(o), { method: "DELETE" });
        toast.success(`${o.courseName} restored`);
      }
      setPending(null);
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Could not change this period."));
    } finally {
      setBusy(false);
    }
  }

  const go = (delta: number) => setDay(addDays(shown, delta));

  return (
    <Screen
      title="Today"
      description="Your periods; check-in opens automatically"
      onBack={router.canGoBack() ? () => router.back() : undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.nav}>
        <Pressable
          onPress={() => go(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          hitSlop={8}
          style={({ pressed }) => [styles.navButton, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
        >
          <ChevronLeft size={20} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => setDay(null)}
          accessibilityRole="button"
          accessibilityLabel={`${dayLabel(shown)}. Go to today`}
          style={{ flex: 1, alignItems: "center" }}
        >
          <Text weight="600">{shown === today ? `Today · ${dayLabel(shown)}` : dayLabel(shown)}</Text>
          {shown !== today ? (
            <Text variant="muted" size="xs">
              Tap for today
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => go(1)}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          hitSlop={8}
          style={({ pressed }) => [styles.navButton, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
        >
          <ChevronRight size={20} color={colors.foreground} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 90 }} />
          <Skeleton style={{ height: 90 }} />
        </View>
      ) : error ? (
        <EmptyState icon={CalendarClock} title="Timetable unavailable" description={error} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No periods"
          description="Periods from the timetables of the courses you teach appear here."
        />
      ) : (
        <Card>
          <CardContent style={{ gap: 8, paddingTop: 16 }}>
            {list.map((o) => {
              const p = phase(o, now);
              const badge = sessionBadge(o, now);
              const handled = !!o.session;
              const live = o.session?.state === "opened" && !!o.session.id && p === "now";
              return (
                <OccurrenceRow key={`${o.entryId}|${o.occursOn}`} occurrence={o}>
                  {badge ? (
                    <View style={{ flexDirection: "row", marginTop: 4 }}>
                      <Badge variant={live ? "default" : "outline"}>{badge}</Badge>
                    </View>
                  ) : null}
                  <View style={styles.actions}>
                    {live ? (
                      <Button
                        size="sm"
                        accessibilityLabel={`Open live attendance for ${o.courseName}`}
                        onPress={() =>
                          router.push(
                            `/attendance/take/${o.courseId}?name=${encodeURIComponent(o.courseName)}` as Href,
                          )
                        }
                      >
                        Live attendance
                      </Button>
                    ) : null}
                    {!handled && p !== "past" && o.status !== "cancelled" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        accessibilityLabel={`Cancel ${o.courseName} ${o.periodName}`}
                        onPress={() => setPending({ occurrence: o, action: "cancel" })}
                      >
                        Cancel period
                      </Button>
                    ) : null}
                    {!handled && o.status !== "scheduled" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        accessibilityLabel={`Restore ${o.courseName} ${o.periodName}`}
                        onPress={() => setPending({ occurrence: o, action: "restore" })}
                      >
                        Restore
                      </Button>
                    ) : null}
                  </View>
                </OccurrenceRow>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Text variant="muted" size="xs">
        To move a period to another time or room, use the course timetable on the web.
        {data?.timeZone ? ` Times are in the school's time zone (${data.timeZone}).` : ""}
      </Text>

      <ConfirmDialog
        open={!!pending}
        title={pending?.action === "cancel" ? "Cancel this period?" : "Restore this period?"}
        message={
          pending
            ? pending.action === "cancel"
              ? `${pending.occurrence.courseName}, ${pending.occurrence.periodName} on ${dayLabel(pending.occurrence.occursOn)}. No check-in session will open and students see it as cancelled.`
              : `${pending.occurrence.courseName} goes back to its usual time and room, and check-in opens as normal.`
            : undefined
        }
        confirmLabel={pending?.action === "cancel" ? "Cancel period" : "Restore"}
        cancelLabel="Keep"
        destructive={pending?.action === "cancel"}
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", gap: 12 },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
});

export default withFeature("timetable", "Today", TodayScreen);
