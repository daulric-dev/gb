import { Linking, StyleSheet, View } from "react-native";
import { Download, ExternalLink } from "lucide-react-native";
import { buildUrl } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { formatDate } from "@/lib/utils";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { type FileItem, formatBytes } from "./types";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text variant="muted">{label}</Text>
      <Text weight="500" style={{ flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * File details as a bottom sheet — the mobile analogue of the web's inline
 * viewer. We don't render document contents on mobile; instead we hand the
 * authenticated stream URL to the OS via Linking.
 */
export function FileDetailsSheet({
  file,
  onClose,
}: {
  file: FileItem | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const open = async (mode: "content" | "download") => {
    if (!file) return;
    const url = buildUrl(`/files/${file.id}/${mode}`);
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error("cannot open");
      await Linking.openURL(url);
    } catch {
      toast.error("Could not open this file");
    }
  };

  const ready = file?.status === "ready";

  return (
    <Sheet open={file !== null} onClose={onClose} title={file?.name}>
      <View style={{ gap: 4 }}>
        <DetailRow
          label="Type"
          value={file?.source === "report" ? "Report" : "Upload"}
        />
        <DetailRow label="Size" value={formatBytes(file?.sizeBytes ?? 0)} />
        <DetailRow label="Added" value={formatDate(file?.createdAt)} />
        <View style={styles.detailRow}>
          <Text variant="muted">Status</Text>
          {ready ? (
            <Badge variant="secondary">Ready</Badge>
          ) : file?.status === "infected" ? (
            <Badge variant="outline" color={colors.destructive}>
              Quarantined
            </Badge>
          ) : file?.status === "failed" ? (
            <Badge variant="outline" color={colors.destructive}>
              Failed
            </Badge>
          ) : (
            <Badge variant="outline">Processing…</Badge>
          )}
        </View>
      </View>

      {ready ? (
        <View style={{ gap: 8 }}>
          <Button
            onPress={() => open("content")}
            icon={<ExternalLink size={16} color={colors.primaryForeground} />}
          >
            Open
          </Button>
          {file?.canDownload ? (
            <Button
              variant="outline"
              onPress={() => open("download")}
              icon={<Download size={16} color={colors.foreground} />}
            >
              Download
            </Button>
          ) : null}
        </View>
      ) : (
        <Text variant="muted">
          This file is still being processed and can't be opened yet.
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
  },
});
