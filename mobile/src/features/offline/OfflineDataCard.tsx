import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/providers/ToastProvider";
import { draftQueue, offlineCache, offlineScope, offlineUsage } from "@/lib/offline-store";
import { prefetchForOffline, resetPrefetch } from "@/lib/offline-sync";
import { useConnectivity } from "./OfflineReads";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings → Offline data: how much this account keeps on the device, and a
 * button to clear the saved copies. Drafts that haven't been sent are kept
 * (they are only on this device); they are managed on their work screens.
 */
export function OfflineDataCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const toast = useToast();
  const network = useConnectivity();
  const [usage, setUsage] = useState(offlineUsage);
  const [confirm, setConfirm] = useState(false);

  const reread = useCallback(() => setUsage(offlineUsage()), []);
  useEffect(() => {
    reread();
    return draftQueue.subscribe(reread);
  }, [reread, refreshKey]);

  function clear() {
    setConfirm(false);
    const scope = offlineScope();
    if (scope) offlineCache.clearScope(scope);
    resetPrefetch();
    reread();
    toast.success("Saved copies cleared");
  }

  async function download() {
    await prefetchForOffline(true).catch(() => {});
    reread();
    toast.success("Your courses are saved for offline reading");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offline data</CardTitle>
      </CardHeader>
      <CardContent style={{ gap: 10 }}>
        <Text variant="muted" size="sm">
          Course pages, modules, work instructions and due dates are saved on
          this device so you can read them without a signal. They are deleted
          when you log out.
        </Text>
        <View style={styles.row}>
          <Text variant="muted" size="sm">
            Storage used
          </Text>
          <Text weight="500">
            {formatBytes(usage.bytes)} ({usage.copies}{" "}
            {usage.copies === 1 ? "item" : "items"})
          </Text>
        </View>
        <View style={styles.row}>
          <Text variant="muted" size="sm">
            Drafts not yet sent
          </Text>
          <Text weight="500">{usage.unsentDrafts}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            variant="outline"
            size="sm"
            disabled={network === "offline"}
            onPress={() => void download()}
          >
            Save my courses now
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={usage.copies === 0}
            onPress={() => setConfirm(true)}
          >
            Clear saved copies
          </Button>
        </View>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title="Clear saved copies?"
        message="Pages and work you saved for offline reading are removed from this device. Drafts that haven't been sent are kept."
        confirmLabel="Clear"
        onConfirm={clear}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
