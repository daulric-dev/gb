import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, ScrollText } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatDate,
  termLabel,
  type PortalReportSummary,
} from "@/lib/portal";

export default function PortalReportsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [reports, setReports] = useState<PortalReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<PortalReportSummary[]>("/portal/me/reports")
        .then(setReports)
        .catch(() => setReports([])),
    [],
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  return (
    <Screen
      title="Reports"
      description="Report books your school has published"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 110 }} />
          <Skeleton style={{ height: 110 }} />
        </View>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No reports yet"
          description="Reports appear here once your school publishes them."
        />
      ) : (
        reports.map((report) => (
          <Pressable
            key={report.id}
            onPress={() => router.push(`/report/${report.id}`)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
          <Card>
            <CardHeader>
              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <CardTitle>
                    {report.type === "year_end"
                      ? "End of year report"
                      : `${termLabel(report.term?.name)} report`}
                  </CardTitle>
                </View>
                <ChevronRight color={colors.mutedForeground} size={16} />
              </View>
              <Text variant="muted" style={{ fontSize: 12 }}>
                {[report.academicYear?.name, formatDate(report.publishedAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </CardHeader>
            <CardContent style={styles.badges}>
              {report.overallAverage !== null && (
                <Badge>Average {report.overallAverage}</Badge>
              )}
              {report.position !== null && (
                <Badge>
                  Position {report.position}
                  {report.totalStudents ? ` of ${report.totalStudents}` : ""}
                </Badge>
              )}
              {report.conductGrade && (
                <Badge variant="outline">Conduct {report.conductGrade}</Badge>
              )}
            </CardContent>
          </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
});
