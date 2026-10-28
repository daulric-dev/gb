import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, AppState, Modal, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Download } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import {
  APP_PLATFORM,
  INSTALLED_VERSION,
  getUpdateRequired,
  subscribeUpdateRequired,
} from "@/lib/update-required";
import {
  checkForUpdate,
  dismissUpdate,
  openStore,
  shouldPromptFor,
} from "@/lib/app-update";

/** How often returning to the foreground re-checks. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Offers an available (not required) update; "Later" holds until the next release. */
export function promptUpdate(latest: string, storeUrl: string | null) {
  Alert.alert(
    "Update available",
    `GradeBook ${latest} is available. You have ${INSTALLED_VERSION ?? "an older version"}.`,
    [
      { text: "Later", style: "cancel", onPress: () => void dismissUpdate(latest) },
      ...(storeUrl
        ? [{ text: "Update", onPress: () => void openStore(storeUrl) }]
        : []),
    ],
  );
}

/**
 * Checks for updates on launch and on returning to the foreground (at most
 * every 6 hours after a successful check), and covers the whole app with
 * "Update required" while this build is below the API's minimum - from that
 * check or a 426 on any request. There is no way past it but updating.
 */
export function UpdateGate() {
  const { required, storeUrl } = useSyncExternalStore(
    subscribeUpdateRequired,
    getUpdateRequired,
  );
  const lastChecked = useRef(0);

  const runCheck = useCallback(async () => {
    if (Date.now() - lastChecked.current < CHECK_EVERY_MS) return;
    const status = await checkForUpdate();
    if (status.kind === "unknown") return; // try again next time
    lastChecked.current = Date.now();
    if (status.kind === "available" && (await shouldPromptFor(status.latest))) {
      promptUpdate(status.latest, status.storeUrl);
    }
  }, []);

  useEffect(() => {
    if (!APP_PLATFORM) return;
    void runCheck();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void runCheck();
    });
    return () => sub.remove();
  }, [runCheck]);

  if (!required) return null;
  return <UpdateRequiredScreen storeUrl={storeUrl} />;
}

function UpdateRequiredScreen({ storeUrl }: { storeUrl: string | null }) {
  const { colors } = useTheme();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function update() {
    setFailed(!(await openStore(storeUrl)));
  }

  async function checkAgain() {
    setChecking(true);
    try {
      await checkForUpdate();
    } finally {
      setChecking(false);
    }
  }

  const store = APP_PLATFORM === "ios" ? "the App Store" : "Google Play";
  return (
    // onRequestClose does nothing: Android's back button can't dismiss it.
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <View style={styles.body}>
          <View style={[styles.icon, { backgroundColor: colors.muted }]}>
            <Download size={28} color={colors.foreground} />
          </View>
          <Text variant="title" style={{ textAlign: "center" }}>
            Update required
          </Text>
          <Text variant="muted" style={{ textAlign: "center" }}>
            This version of GradeBook
            {INSTALLED_VERSION ? ` (${INSTALLED_VERSION})` : ""} is no longer
            supported. Update the app from {store} to keep using it.
          </Text>
          {failed || !storeUrl ? (
            <Text tone="muted" size="sm" style={{ textAlign: "center" }}>
              {storeUrl
                ? `Couldn't open ${store}. Open it and search for GradeBook.`
                : `Open ${store} and search for GradeBook.`}
            </Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          {storeUrl ? <Button onPress={update}>Update</Button> : null}
          <Button variant="outline" onPress={checkAgain} loading={checking}>
            Check again
          </Button>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: 24 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  actions: { gap: 10 },
});
