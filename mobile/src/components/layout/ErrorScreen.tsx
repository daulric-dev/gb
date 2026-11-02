import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { TriangleAlert } from "lucide-react-native";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors";

function ErrorBody({ retry }: { retry: () => void }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
        <EmptyState
          icon={TriangleAlert}
          title="This screen could not be loaded"
          description={GENERIC_ERROR_MESSAGE}
          action={<Button onPress={retry}>Try again</Button>}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * The root `ErrorBoundary` (exported from app/_layout.tsx). It replaces the
 * root layout when a render fails, so it brings its own theme and safe-area
 * providers. It shows a fixed, friendly message and "Try again"; the error
 * itself only goes to the console.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBody retry={() => void retry()} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inner: { flex: 1, justifyContent: "center", padding: 16 },
});
