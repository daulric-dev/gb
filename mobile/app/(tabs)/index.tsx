import { useCallback, useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AdminDashboard } from "@/features/dashboard/AdminDashboard";
import { TeacherDashboard } from "@/features/dashboard/TeacherDashboard";

type Tab = "admin" | "teacher";

export default function DashboardScreen() {
  const { profile } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>("admin");

  // Each dashboard loads its own data; remounting them is the refresh.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 400);
  }, []);

  const displayName = profile?.first_name ?? "there";
  const schoolName = profile?.school?.name ?? "your school";
  const isAdmin = profile?.role === "admin";

  return (
    <Screen
      title={`Hello ${displayName}`}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {isAdmin ? (
        <View style={{ gap: 20 }}>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "admin", label: "School Overview" },
              { value: "teacher", label: "My Courses" },
            ]}
          />
          {tab === "admin" ? (
            <AdminDashboard key={refreshKey} schoolName={schoolName} />
          ) : (
            <TeacherDashboard refreshKey={refreshKey} />
          )}
        </View>
      ) : (
        <TeacherDashboard refreshKey={refreshKey} />
      )}
    </Screen>
  );
}
