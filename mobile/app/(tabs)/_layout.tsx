import { Redirect, Tabs } from "expo-router";
import {
  LayoutDashboard,
  Users,
  UserRoundSearch,
  Settings,
  LayoutGrid,
} from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Loading } from "@/components/layout/Loading";
import { isStudentProfile } from "@/lib/routing";

export default function TabsLayout() {
  const { profile, loading } = useAuth();
  const { colors, clay } = useTheme();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!profile.first_name) return <Redirect href="/(auth)/onboard" />;
  // The staff API denies students everything, so show them the portal rather
  // than a tab bar of permission errors.
  if (isStudentProfile(profile)) return <Redirect href="/(portal)" />;
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
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <LayoutDashboard color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: "Students",
          tabBarIcon: ({ color, size }) => (
            <UserRoundSearch color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid color={color} size={size} />
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
