import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Download, FileBadge } from "lucide-react-native";
import { downloadAndOpen } from "@/lib/open-file";
import type { ParentChild } from "@/lib/parent";
import {
  parentReportFilePath,
  parentReportsPath,
  parentTranscriptPdfPath,
  reportTitle,
  type PublishedReport,
} from "@/lib/reports";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ParentScreen, useChildResource } from "@/features/parent/ParentScreen";

/** A child's published term reports; each opens as a PDF in the share sheet. */
function Reports({ child }: { child: ParentChild }) {
  const toast = useToast();
  const { colors } = useTheme();
  const res = useChildResource<PublishedReport[]>(parentReportsPath(child.id));
  const [opening, setOpening] = useState<string | null>(null);

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

  if (res.error) return <Text variant="muted">{res.error}</Text>;
  if (!res.data) return null;
  if (res.data.length === 0) {
    return <Text variant="muted">No reports yet. The school publishes a report at the end of each term.</Text>;
  }

  return (
    <View style={{ gap: 12 }}>
      {res.data.map((r) => (
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
                onPress={() => open(r.id, parentReportFilePath(child.id, r.id), `${r.termName} report.pdf`)}
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
        onPress={() => open("transcript", parentTranscriptPdfPath(child.id), "transcript.pdf")}
      >
        Open transcript (PDF)
      </Button>
    </View>
  );
}

export default function ParentReportsScreen() {
  return <ParentScreen title="Reports" render={(child) => <Reports key={child.id} child={child} />} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
});
