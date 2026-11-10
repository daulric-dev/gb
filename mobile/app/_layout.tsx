import "react-native-gesture-handler";
import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { PermissionsProvider } from "@/providers/PermissionsProvider";
import { ToastProvider } from "@/providers/ToastProvider";
import { NotificationRouter } from "@/providers/NotificationRouter";
import { UpdateGate } from "@/features/app-update/UpdateGate";
import { setUnauthorizedHandler } from "@/lib/api";
import { clearOpenedFiles } from "@/lib/open-file";
import { clearOfflineReads } from "@/lib/offline-store";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { Loading } from "@/components/layout/Loading";
import { ServerSetupScreen } from "@/components/auth/ServerSetupScreen";
import { ApiServerProvider, useApiServer } from "@/providers/ApiServerProvider";
import { OfflineProvider } from "@/providers/OfflineProvider";

/** A render error anywhere shows a friendly screen with "Try again", never the error text. */
export { ErrorScreen as ErrorBoundary };

function RootNavigator() {
  const { scheme, colors } = useTheme();
  const router = useRouter();

  // Mirror the web app's global 401 → /login behaviour. Signed out by the
  // server: drop the previous session's downloaded files, as logout does.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearOpenedFiles();
      // Saved copies go; this account's unsent drafts stay for its next sign-in.
      clearOfflineReads();
      router.replace("/(auth)/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <NotificationRouter />
      {/*
        Default animation is a slide, so every pushed secondary section
        (announcements, chat, files, staff, academic-calendar,
        grade-scales, roles) drills in with a slide. The app
        shell routes below opt back into "fade". Sections auto-register from the
        filesystem, so they need no explicit <Stack.Screen> here.
      */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" options={{ animation: "fade" }} />
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
      </Stack>
      {/* Last, so "Update required" covers everything above. */}
      <UpdateGate />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <ApiServerProvider>
              <ConfiguredApp />
            </ApiServerProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ConfiguredApp() {
  const { ready, serverUrl, error, connect } = useApiServer();

  if (!ready) return <Loading />;
  if (!serverUrl)
    return <ServerSetupScreen error={error} onConnect={connect} />;

  return (
    <AuthProvider>
      <OfflineProvider>
        <PermissionsProvider>
          <RootNavigator />
        </PermissionsProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}
