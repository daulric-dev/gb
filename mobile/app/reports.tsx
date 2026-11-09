import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Download, FileBadge } from "lucide-react-native";
import { api } from "@/lib/api";
import { downloadAndOpen } from "@/lib/open-file";
import { isFeatureDisabledError } from "@/lib/features";
import {
  reportFilePath,
  reportTitle,
  TRANSCRIPT_PDF_PATH,
  type PublishedReport,
} from "@/lib/reports";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

/** The student's published term reports; each opens as a PDF in the share sheet. */
export default function ReportsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [reports, setReports] = useState<PublishedReport[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [off, setOff] = useState(false);

  const load = useCallback(
    () =>
      api<PublishedReport[]>("/portal/me/reports")
        .then((list) => {
          setReports(list);
          setOff(false);
        })
        .catch((err) => {
          if (isFeatureDisabledError(err)) setOff(true);
          setReports([]);
        }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  async function open(key: string, path: string, name: string) {
    setOpening(key);
    try {
      await downloadAndOpen(path, name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the report");
    } finally {
      setOpening(null);
    }
  }

  return (
    <Screen
      title="Reports"
      description="Your term reports"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {reports === null ? (
        <View style={{ gap: 12 }}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
        </View>
      ) : off ? (
        <EmptyState icon={FileBadge} title="Reports are turned off" description="Your school has switched report cards off." />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FileBadge}
          title="No reports yet"
          description="Your school will publish a report at the end of each term."
        />
      ) : (
        <View style={{ gap: 12 }}>
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent style={styles.row}>
                <FileBadge color={colors.mutedForeground} size={22} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontWeight: "600" }}>{reportTitle(r)}</Text>
                  <Text variant="muted" size="xs">
                    Published {new Date(r.publishedAt).toLocaleDateString()}
                  </Text>
                </View>
                {r.status === "ready" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={opening === r.id}
                    disabled={opening !== null}
                    accessibilityLabel={`Open ${reportTitle(r)} report`}
                    icon={<Download color={colors.foreground} size={16} />}
                    onPress={() => open(r.id, reportFilePath(r.id), `${r.termName} report.pdf`)}
                  >
                    Open
                  </Button>
                ) : (
                  <Badge variant="outline">Being prepared</Badge>
                )}
              </CardContent>
            </Card>
          ))}
          <Button
            variant="outline"
            loading={opening === "transcript"}
            disabled={opening !== null}
            onPress={() => open("transcript", TRANSCRIPT_PDF_PATH, "transcript.pdf")}
          >
            Open transcript (PDF)
          </Button>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
});
