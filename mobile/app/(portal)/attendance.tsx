import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CalendarCheck } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import {
  attendanceRate,
  formatDate,
  type PortalAttendance,
} from "@/lib/portal";

export default function PortalAttendanceScreen() {
  const { colors } = useTheme();
  const [data, setData] = useState<PortalAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<PortalAttendance>("/portal/me/attendance")
        .then(setData)
        .catch(() => setData(null)),
    [],
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const summary = data?.summary;
  const records = data?.records ?? [];
  const rate = attendanceRate(summary ?? null);

  const toneFor = (status: string) =>
    status === "present"
      ? colors.primary
      : status === "late"
        ? colors.mutedForeground
        : colors.destructive;

  return (
    <Screen
      title="Attendance"
      description={
        rate === null ? "Your attendance record" : `${rate}% attendance`
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 200 }} />
        </View>
      ) : records.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No attendance recorded"
          description="Your daily attendance will appear here."
        />
      ) : (
        <>
          {summary && (
            <View style={styles.tallies}>
              <Tally label="Present" value={summary.present} />
              <Tally label="Late" value={summary.late} />
              <Tally label="Absent" value={summary.absent} />
            </View>
          )}

          <Card>
            <CardContent style={{ gap: 10 }}>
              {records.map((r) => (
                <View key={r.id} style={styles.row}>
                  <Text>{formatDate(r.date)}</Text>
                  <Badge color={toneFor(r.status)} variant="outline">
                    {r.status}
                  </Badge>
                </View>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </Screen>
  );
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <Card style={{ flex: 1 }}>
      <CardContent style={{ alignItems: "center", paddingVertical: 14 }}>
        <Text weight="700" style={{ fontSize: 22 }}>
          {value}
        </Text>
        <Text variant="muted" style={{ fontSize: 12 }}>
          {label}
        </Text>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  tallies: { flexDirection: "row", gap: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
