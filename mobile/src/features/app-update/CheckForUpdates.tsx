import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/providers/ToastProvider";
import { APP_PLATFORM, INSTALLED_VERSION } from "@/lib/update-required";
import { checkForUpdate } from "@/lib/app-update";
import { promptUpdate } from "./UpdateGate";

/**
 * Settings card: the installed version and an on-demand update check. A
 * required update opens the blocking screen by itself (UpdateGate). Hidden on
 * web, which has no store build.
 */
export function CheckForUpdates() {
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  if (!APP_PLATFORM) return null;

  async function check() {
    setChecking(true);
    try {
      const status = await checkForUpdate();
      if (status.kind === "current") toast.success("You're up to date");
      else if (status.kind === "available")
        promptUpdate(status.latest, status.storeUrl);
      else if (status.kind === "unknown")
        toast.error("Couldn't check for updates. Try again later.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App</CardTitle>
      </CardHeader>
      <CardContent style={{ gap: 12 }}>
        <View style={styles.row}>
          <Text variant="muted" style={{ fontSize: 13 }}>
            Version
          </Text>
          <Text weight="500">{INSTALLED_VERSION ?? "-"}</Text>
        </View>
        <Button variant="outline" onPress={check} loading={checking}>
          Check for updates
        </Button>
      </CardContent>
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
});
