import { Redirect, Tabs } from "expo-router";
import { CalendarCheck, FileBadge, GraduationCap, LayoutDashboard, Megaphone, Settings, Target } from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Loading } from "@/components/layout/Loading";
import { homeRouteFor, isParentProfile } from "@/lib/routing";
import { ParentProvider, useParent } from "@/features/parent/ParentContext";

/**
 * The parent area: read-only views of the parent's linked children. Only
 * parent accounts get here; tabs the child's school hides are hidden
 * (href: null), and the API refuses them anyway.
 */
export default function ParentLayout() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!isParentProfile(profile)) return <Redirect href={homeRouteFor(profile)} />;
  return (
    <ParentProvider>
      <ParentTabs />
    </ParentProvider>
  );
}

function ParentTabs() {
  const { colors, clay } = useTheme();
  const { selected } = useParent();
  const v = selected?.visibility;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0, boxShadow: clay.surface },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="child-grades"
        options={{
          title: "Grades",
          href: v && !v.grades ? null : undefined,
          tabBarIcon: ({ color, size }) => <GraduationCap color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="child-attendance"
        options={{
          title: "Attendance",
          href: v && !v.attendance ? null : undefined,
          tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="child-news"
        options={{
          title: "News",
          href: v && !v.announcements ? null : undefined,
          tabBarIcon: ({ color, size }) => <Megaphone color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="child-reports"
        options={{
          title: "Reports",
          href: v && !v.reports ? null : undefined,
          tabBarIcon: ({ color, size }) => <FileBadge color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="child-outcomes"
        options={{
          title: "Outcomes",
          // Hidden unless the school shows mastery (older servers send nothing).
          href: v?.mastery ? undefined : null,
          tabBarIcon: ({ color, size }) => <Target color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="parent-settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
