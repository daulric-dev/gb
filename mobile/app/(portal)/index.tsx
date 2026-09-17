import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CalendarCheck, ScrollText } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import {
  attendanceRate,
  formatDate,
  type PortalAttendance,
  type PortalMe,
  type PortalReportSummary,
} from "@/lib/portal";

export default function PortalHomeScreen() {
  const { profile } = useAuth();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [attendance, setAttendance] = useState<PortalAttendance | null>(null);
  const [reports, setReports] = useState<PortalReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [meData, attData, reportData] = await Promise.all([
      api<PortalMe>("/portal/me").catch(() => null),
      api<PortalAttendance>("/portal/me/attendance").catch(() => null),
      api<PortalReportSummary[]>("/portal/me/reports").catch(() => []),
    ]);
    setMe(meData);
    setAttendance(attData);
    setReports(reportData ?? []);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const rate = attendanceRate(attendance?.summary ?? null);
  const latest = reports[0] ?? null;
  const activeClass =
    me?.classes.find((c) => c.academicYear?.isActive) ?? me?.classes[0] ?? null;

  return (
    <Screen
      title={`Hello ${me?.firstName ?? profile?.first_name ?? "there"}`}
      description={
        activeClass?.name
          ? [activeClass.name, activeClass.academicYear?.name]
              .filter(Boolean)
              .join(" · ")
          : (profile?.school?.name ?? undefined)
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.stats}>
        <StatCard
          icon={CalendarCheck}
          value={rate === null ? "-" : `${rate}%`}
          label="Attendance"
          loading={loading}
        />
        <StatCard
          icon={ScrollText}
          value={reports.length}
          label="Reports"
          loading={loading}
        />
      </View>

      {loading ? (
        <Skeleton style={{ height: 120 }} />
      ) : (
        <>
          {latest && (
            <Card>
              <CardHeader>
                <CardTitle>Latest report</CardTitle>
                <Text variant="muted" style={{ fontSize: 12 }}>
                  Published {formatDate(latest.publishedAt)}
                </Text>
              </CardHeader>
              <CardContent style={styles.badgeRow}>
                {latest.overallAverage !== null && (
                  <Badge>Average {latest.overallAverage}</Badge>
                )}
                {latest.position !== null && (
                  <Badge>
                    Position {latest.position}
                    {latest.totalStudents ? ` of ${latest.totalStudents}` : ""}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}

          {me && me.classes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Your classes</CardTitle>
              </CardHeader>
              <CardContent style={{ gap: 8 }}>
                {me.classes.map((c) => (
                  <View key={c.id} style={styles.classRow}>
                    <Text weight="500">{c.name}</Text>
                    <Text variant="muted" style={{ fontSize: 12 }}>
                      {c.academicYear?.name}
                    </Text>
                  </View>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: 12 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  classRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
