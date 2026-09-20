import { Redirect, Tabs } from "expo-router";
import {
  LayoutDashboard,
  NotebookPen,
  ClipboardList,
  CalendarCheck,
  ScrollText,
  Settings,
} from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Loading } from "@/components/layout/Loading";
import { isStudentProfile } from "@/lib/routing";

/**
 * The student area. Staff are sent to the tabs; a student with no school has
 * not redeemed a claim code yet, so there is nothing to show them here.
 */
export default function PortalLayout() {
  const { profile, loading } = useAuth();
  const { colors, clay } = useTheme();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!profile.first_name) return <Redirect href="/(auth)/onboard" />;
  if (!isStudentProfile(profile)) return <Redirect href="/(tabs)" />;
  if (!profile.school) return <Redirect href="/(auth)/schools" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        // The bar is a clay surface in its own right: no hairline rule, and
        // the shadow above it separates it from the content instead.
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 0,
          boxShadow: clay.surface,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, size }) => (
            <LayoutDashboard color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: "Work",
          tabBarIcon: ({ color, size }) => (
            <NotebookPen color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: "Grades",
          tabBarIcon: ({ color, size }) => (
            <ClipboardList color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          tabBarIcon: ({ color, size }) => (
            <CalendarCheck color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => (
            <ScrollText color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
