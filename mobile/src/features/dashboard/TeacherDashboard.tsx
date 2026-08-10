import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BookOpen, Users } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import type { ClassItem } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { StatCard } from "@/components/ui/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";

interface ClassReport {
  classId: string;
  className: string;
  isClassTeacher: boolean;
  studentCount: number;
}

export function TeacherDashboard({ classes }: { classes: ClassItem[] }) {
  const { colors } = useTheme();
  const [reports, setReports] = useState<ClassReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (classes.length === 0) {
      setReports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      classes.map(async (c) => {
        const students = await api<{ id: string }[]>(
          `/classes/${c.id}/students`,
        ).catch(() => [] as { id: string }[]);
        return {
          classId: c.id,
          className: c.name ?? "Untitled class",
          isClassTeacher: c.isClassTeacher === true,
          studentCount: students.length,
        };
      }),
    ).then((built) => {
      if (cancelled) return;
      setReports(built);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [classes]);

  if (classes.length === 0) {
    return (
      <Card>
        <CardContent style={styles.empty}>
          <BookOpen size={40} color={colors.mutedForeground} />
          <Text weight="600" style={{ marginTop: 12 }}>
            You haven&apos;t been assigned any classes yet
          </Text>
          <Text variant="muted" style={{ textAlign: "center", marginTop: 4 }}>
            Once an admin assigns you to a class, your students will appear
            here.
          </Text>
        </CardContent>
      </Card>
    );
  }

  const totalStudents = reports.reduce((sum, r) => sum + r.studentCount, 0);

  return (
    <View style={styles.wrap}>
      <Text variant="muted">Overview of your classes and students.</Text>

      <View style={styles.statGrid}>
        <StatCard icon={BookOpen} value={classes.length} label="My Classes" />
        <StatCard
          icon={Users}
          value={loading ? "…" : totalStudents}
          label="Total Students"
          loading={loading}
        />
      </View>

      <View style={{ gap: 12 }}>
        <Text variant="subtitle">My Classes</Text>
        {loading
          ? classes.map((c) => (
              <Skeleton key={c.id} style={{ height: 92, borderRadius: 14 }} />
            ))
          : reports.map((report) => (
              <Card key={report.classId}>
                <CardHeader style={styles.classHeader}>
                  <View style={{ flex: 1 }}>
                    <CardTitle>{report.className}</CardTitle>
                  </View>
                  {report.isClassTeacher && (
                    <Badge variant="secondary">Class Teacher</Badge>
                  )}
                </CardHeader>
                <CardContent style={styles.classStats}>
                  <View style={styles.stat}>
                    <Text style={{ fontSize: 18, fontWeight: "700" }}>
                      {report.studentCount}
                    </Text>
                    <Text variant="muted" style={{ fontSize: 12 }}>
                      Students
                    </Text>
                  </View>
                </CardContent>
              </Card>
            ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  classHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 12,
  },
  classStats: {
    flexDirection: "row",
    paddingTop: 0,
  },
  stat: {
    alignItems: "center",
  },
});
