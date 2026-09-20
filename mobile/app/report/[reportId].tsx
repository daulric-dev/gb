import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Percent, Trophy } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { formatDate, termLabel, type PortalReport } from "@/lib/portal";

function score(entry: PortalReport["entries"][number]) {
  return (
    entry.termComposite ??
    entry.termGrade ??
    entry.termAverage ??
    entry.yearGrade
  );
}

/**
 * One published report book.
 *
 * Only reports the school has published reach this endpoint, so everything
 * here is safe to show; ungraded subjects still appear, marked as such,
 * because their absence would read as a missing subject rather than one that
 * is not scored.
 */
export default function PortalReportDetailScreen() {
  const router = useRouter();
  const { reportId } = useLocalSearchParams<{ reportId: string }>();

  const [report, setReport] = useState<PortalReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!reportId) return;
    const data = await api<PortalReport>(`/portal/me/reports/${reportId}`).catch(
      () => null,
    );
    setReport(data);
  }, [reportId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <Screen title="Report" onBack={() => router.back()}>
        <Skeleton style={{ height: 120 }} />
        <Skeleton style={{ height: 220, marginTop: 12 }} />
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen
        title="Report"
        description="This could not be loaded"
        onBack={() => router.back()}
      >
        <View />
      </Screen>
    );
  }

  const attendance =
    report.attendanceDays !== null && report.totalSchoolDays
      ? `${report.attendanceDays}/${report.totalSchoolDays} days`
      : null;

  return (
    <Screen
      title={termLabel(report.term?.name) || "Report"}
      description={[report.academicYear?.name, formatDate(report.publishedAt)]
        .filter(Boolean)
        .join(" · ")}
      onBack={() => router.back()}
    >
      <View style={{ gap: 12 }}>
        <View style={styles.stats}>
          <StatCard
            icon={Percent}
            label="Average"
            value={
              report.overallAverage !== null
                ? `${report.overallAverage}%`
                : "—"
            }
          />
          <StatCard
            icon={Trophy}
            label="Position"
            value={
              report.position !== null
                ? `${report.position}${report.totalStudents ? ` of ${report.totalStudents}` : ""}`
                : "—"
            }
          />
        </View>

        {(attendance || report.conductGrade) && (
          <Card>
            <CardContent style={styles.meta}>
              {attendance ? (
                <View style={{ gap: 2 }}>
                  <Text variant="muted" size="xs">
                    Attendance
                  </Text>
                  <Text size="sm">{attendance}</Text>
                </View>
              ) : null}
              {report.conductGrade ? (
                <View style={{ gap: 2 }}>
                  <Text variant="muted" size="xs">
                    Conduct
                  </Text>
                  <Text size="sm">{report.conductGrade}</Text>
                </View>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Subjects</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 10 }}>
            {report.entries.length === 0 ? (
              <Text variant="muted" size="sm">
                No subjects recorded on this report.
              </Text>
            ) : (
              report.entries.map((entry) => {
                const value = score(entry);
                return (
                  <View key={entry.id} style={{ gap: 4 }}>
                    <View style={styles.subjectRow}>
                      <Text size="sm" weight="500" style={{ flex: 1 }}>
                        {entry.subject?.name ?? "Unknown subject"}
                      </Text>
                      {!entry.isGraded ? (
                        <Badge variant="outline">Not graded</Badge>
                      ) : (
                        <Badge>
                          {value !== null ? `${value}%` : "—"}
                          {entry.letterGrade ? ` · ${entry.letterGrade}` : ""}
                        </Badge>
                      )}
                    </View>
                    {entry.teacherRemark ? (
                      <Text variant="muted" size="xs">
                        {entry.teacherRemark}
                      </Text>
                    ) : null}
                  </View>
                );
              })
            )}
          </CardContent>
        </Card>

        {report.generalRemarks ? (
          <Card>
            <CardHeader>
              <CardTitle>Remarks</CardTitle>
            </CardHeader>
            <CardContent>
              <Text variant="muted" size="sm">
                {report.generalRemarks}
              </Text>
            </CardContent>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: 12 },
  meta: { flexDirection: "row", gap: 24 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
