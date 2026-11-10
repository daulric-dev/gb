import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  addDays,
  dayLabel,
  groupByDate,
  localToday,
  shortDay,
  weekStart,
  type TimetableRange,
} from "@/lib/timetable";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { withFeature } from "@/components/layout/FeatureGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { OccurrenceRow } from "@/features/timetable/OccurrenceRow";

/** The student's week: every period of their courses, with changes. */
function StudentTimetableScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [monday, setMonday] = useState(() => weekStart(localToday()));
  const [data, setData] = useState<TimetableRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<TimetableRange>(`/portal/me/timetable?from=${monday}&to=${addDays(monday, 6)}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((err) => setError(userMessage(err, "Could not load your timetable."))),
    [monday],
  );

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const days = groupByDate(data?.occurrences ?? []);
  const today = data?.today ?? localToday();
  const weekLabel = `${shortDay(monday)} – ${shortDay(addDays(monday, 6))}`;

  const navButton = (label: string, onPress: () => void, icon: ReactNode) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.navButton,
        { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {icon}
    </Pressable>
  );

  return (
    <Screen
      title="Timetable"
      description="Your periods this week"
      onBack={router.canGoBack() ? () => router.back() : undefined}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.nav}>
        {navButton(
          "Previous week",
          () => setMonday((m) => addDays(m, -7)),
          <ChevronLeft size={20} color={colors.foreground} />,
        )}
        <Pressable
          onPress={() => setMonday(weekStart(today))}
          accessibilityRole="button"
          accessibilityLabel={`Week of ${weekLabel}. Go to this week`}
          style={{ flex: 1, alignItems: "center" }}
        >
          <Text weight="600">{weekLabel}</Text>
          {weekStart(today) !== monday ? (
            <Text variant="muted" size="xs">
              Tap for this week
            </Text>
          ) : null}
        </Pressable>
        {navButton(
          "Next week",
          () => setMonday((m) => addDays(m, 7)),
          <ChevronRight size={20} color={colors.foreground} />,
        )}
      </View>

      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </View>
      ) : error ? (
        <EmptyState icon={CalendarClock} title="Timetable unavailable" description={error} />
      ) : days.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No periods this week"
          description="Periods from your courses' timetables appear here."
        />
      ) : (
        days.map((day) => (
          <Card key={day.date}>
            <CardHeader>
              <CardTitle>
                {day.date === today ? `Today · ${dayLabel(day.date)}` : dayLabel(day.date)}
              </CardTitle>
            </CardHeader>
            <CardContent style={{ gap: 8 }}>
              {day.items.map((o) => (
                <OccurrenceRow key={`${o.entryId}|${o.occursOn}`} occurrence={o} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
      {data?.timeZone ? (
        <Text variant="muted" size="xs">
          Times are in the school&apos;s time zone ({data.timeZone}).
        </Text>
      ) : null}
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
});

export default withFeature("timetable", "Timetable", StudentTimetableScreen);
