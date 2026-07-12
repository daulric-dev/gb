import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";
import type { ClassItem } from "@/lib/types";
import { Screen } from "@/components/layout/Screen";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AdminDashboard } from "@/features/dashboard/AdminDashboard";
import { TeacherDashboard } from "@/features/dashboard/TeacherDashboard";

type Mode = "admin-only" | "teacher-only" | "both";
type Tab = "admin" | "teacher";

function pickMode(role: string | null | undefined, classes: ClassItem[]): Mode {
  const isAdmin = role === "admin";
  const hasClasses = classes.length > 0;
  if (isAdmin && hasClasses) return "both";
  if (isAdmin) return "admin-only";
  return "teacher-only";
}

export default function DashboardScreen() {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("admin");

  useEffect(() => {
    api<ClassItem[]>("/classes")
      .then((data) => setClasses(data))
      .catch(() => setClasses([]))
      .finally(() => setLoading(false));
  }, []);

  const displayName = profile?.first_name ?? "there";
  const schoolName = profile?.school?.name ?? "your school";
  const mode = loading ? null : pickMode(profile?.role, classes);

  return (
    <Screen title={`Hello ${displayName}`}>
      {!mode ? (
        <View style={styles.skeletonGrid}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : mode === "admin-only" ? (
        <AdminDashboard schoolName={schoolName} />
      ) : mode === "teacher-only" ? (
        <TeacherDashboard classes={classes} />
      ) : (
        <View style={{ gap: 20 }}>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "admin", label: "School Overview" },
              { value: "teacher", label: "My Classes" },
            ]}
          />
          {tab === "admin" ? (
            <AdminDashboard schoolName={schoolName} />
          ) : (
            <TeacherDashboard classes={classes} />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  skeletonCard: {
    height: 76,
    borderRadius: 14,
    flexGrow: 1,
    minWidth: 150,
  },
});
