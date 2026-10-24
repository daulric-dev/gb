import "react-native-gesture-handler";
import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { AuthProvider } from "@/providers/AuthProvider";
import { PermissionsProvider } from "@/providers/PermissionsProvider";
import { ToastProvider, useToast } from "@/providers/ToastProvider";
import { setSubscriptionNoticeHandler } from "@/lib/subscription-required";
import { NotificationRouter } from "@/providers/NotificationRouter";
import { setUnauthorizedHandler } from "@/lib/api";

function RootNavigator() {
  const { scheme, colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  // The toast API object is rebuilt every render; read it through a ref so the
  // handler is registered once.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  // Mirror the web app's global 401 → /login behaviour.
  useEffect(() => {
    setUnauthorizedHandler(() => router.replace("/(auth)/login"));
    return () => setUnauthorizedHandler(null);
  }, [router]);

  // A 402 SUBSCRIPTION_REQUIRED (school read-only) shows one toast per burst.
  useEffect(() => {
    setSubscriptionNoticeHandler((message) => toastRef.current.error(message));
    return () => setSubscriptionNoticeHandler(null);
  }, []);

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
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <PermissionsProvider>
                <RootNavigator />
              </PermissionsProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
