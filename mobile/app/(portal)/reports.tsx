import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ScrollText } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatDate,
  termLabel,
  type PortalReportSummary,
} from "@/lib/portal";

export default function PortalReportsScreen() {
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
          <Card key={report.id}>
            <CardHeader>
              <CardTitle>
                {report.type === "year_end"
                  ? "End of year report"
                  : `${termLabel(report.term?.name)} report`}
              </CardTitle>
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
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
