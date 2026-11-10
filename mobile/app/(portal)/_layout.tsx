import { Redirect, Tabs } from "expo-router";
import {
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  NotebookPen,
  Settings,
} from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Loading } from "@/components/layout/Loading";
import { homeRouteFor, isStudentProfile } from "@/lib/routing";
import { resolveFeatures } from "@/lib/features";

/**
 * The student area. Staff are sent to the tabs; a student with no school has
 * not joined with a school code yet, so there is nothing to show them here.
 */
export default function PortalLayout() {
  const { profile, loading } = useAuth();
  const { colors, clay } = useTheme();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!profile.first_name) return <Redirect href="/(auth)/onboard" />;
  if (!isStudentProfile(profile)) return <Redirect href={homeRouteFor(profile)} />;
  if (!profile.school) return <Redirect href="/(auth)/schools" />;

  // Tabs for switched-off features are hidden (href: null), not removed, so
  // the route table stays stable when the school changes its features.
  const features = resolveFeatures(profile.features);

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
          title: "Home",
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
        name="calendar"
        options={{
          title: "Calendar",
          href: features.calendar ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          href: features.student_messaging ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <MessageSquare color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: "Grades",
          tabBarIcon: ({ color, size }) => (
            <GraduationCap color={color} size={size} />
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
