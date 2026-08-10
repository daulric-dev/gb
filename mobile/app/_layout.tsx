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
import { setUnauthorizedHandler } from "@/lib/api";

function RootNavigator() {
  const { scheme, colors } = useTheme();
  const router = useRouter();

  // Mirror the web app's global 401 → /login behaviour.
  useEffect(() => {
    setUnauthorizedHandler(() => router.replace("/(auth)/login"));
    return () => setUnauthorizedHandler(null);
  }, [router]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/*
        Default animation is a slide, so every pushed secondary section
        (announcements, chat, files, staff, subjects, academic-calendar,
        grade-scales, roles, class/[classId]) drills in with a slide. The app
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
