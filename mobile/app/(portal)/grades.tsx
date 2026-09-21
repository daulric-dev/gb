import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ClipboardList } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate, termLabel, type PortalSubjectGrades } from "@/lib/portal";

function percent(score: number | null, maxScore: number | null) {
  if (score === null || maxScore === null || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

export default function PortalGradesScreen() {
  const [subjects, setSubjects] = useState<PortalSubjectGrades[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api<PortalSubjectGrades[]>("/portal/me/grades")
        .then(setSubjects)
        .catch(() => setSubjects([])),
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
      title="Grades"
      description="Your marks, grouped by subject"
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 140 }} />
          <Skeleton style={{ height: 140 }} />
        </View>
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No grades yet"
          description="Marks appear here once your teachers record them."
        />
      ) : (
        subjects.map((subject) => (
          <Card key={subject.subject?.id ?? "unknown"}>
            <CardHeader style={styles.header}>
              <CardTitle>{subject.subject?.name ?? "Unassigned"}</CardTitle>
              {subject.average !== null && (
                <Badge>Average {subject.average}%</Badge>
              )}
            </CardHeader>
            <CardContent style={{ gap: 10 }}>
              {subject.assessments.map((a) => {
                const pct = percent(a.score, a.maxScore);
                return (
                  <View key={a.id} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text weight="500">{a.title}</Text>
                      <Text variant="muted" style={{ fontSize: 12 }}>
                        {termLabel(a.term?.name)} · {formatDate(a.date)}
                      </Text>
                    </View>
                    <View style={styles.rowScore}>
                      {a.score === null ? (
                        <Text variant="muted" style={{ fontSize: 12 }}>
                          Not marked
                        </Text>
                      ) : (
                        <>
                          <Text weight="600">
                            {a.score}
                            {a.maxScore !== null ? `/${a.maxScore}` : ""}
                          </Text>
                          {pct !== null && (
                            <Text variant="muted" style={{ fontSize: 11 }}>
                              {pct}%
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowMain: { flex: 1, minWidth: 0 },
  rowScore: { alignItems: "flex-end" },
});
