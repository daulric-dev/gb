import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  GraduationCap,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import type {
  AcademicYear,
  JoinRequest,
  SchoolMember,
  SchoolStudent,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { StatCard } from "@/components/ui/StatCard";
import { DonutChart, type DonutSegment } from "@/components/charts/DonutChart";
import { formatDate, capitalize } from "@/lib/utils";

const STAFF_LABELS: Record<SchoolMember["role"], string> = {
  admin: "Admins",
  teacher: "Teachers",
  member: "Members",
};

export function AdminDashboard({ schoolName }: { schoolName: string }) {
  const { colors } = useTheme();
  const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
  const [members, setMembers] = useState<SchoolMember[]>([]);
  const [students, setStudents] = useState<SchoolStudent[]>([]);
  const [pending, setPending] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<AcademicYear | null>("/academic-years/active").catch(() => null),
      api<SchoolMember[]>("/schools/members").catch(() => []),
      api<SchoolStudent[]>("/students").catch(() => []),
      api<JoinRequest[]>("/schools/join-requests").catch(() => []),
    ])
      .then(([year, mems, studs, reqs]) => {
        setActiveYear(year);
        setMembers(mems);
        setStudents(studs);
        setPending(reqs);
      })
      .finally(() => setLoading(false));
  }, []);

  const staffData: DonutSegment[] = (() => {
    const counts: Record<SchoolMember["role"], number> = {
      admin: 0,
      teacher: 0,
      member: 0,
    };
    for (const m of members) counts[m.role] += 1;
    const palette = [colors.chart1, colors.chart2, colors.chart3];
    return (Object.keys(counts) as SchoolMember["role"][])
      .filter((k) => counts[k] > 0)
      .map((k, i) => ({
        key: k,
        name: STAFF_LABELS[k],
        value: counts[k],
        color: palette[i % palette.length],
      }));
  })();

  const studentData: DonutSegment[] = (() => {
    const counts = { male: 0, female: 0 };
    for (const s of students) {
      if (!s.is_active) continue;
      if (s.gender === "male" || s.gender === "female") counts[s.gender] += 1;
    }
    return [
      { key: "male", name: "Male", value: counts.male, color: colors.chart2 },
      {
        key: "female",
        name: "Female",
        value: counts.female,
        color: colors.chart4,
      },
    ].filter((d) => d.value > 0);
  })();

  const activeStudents = students.filter((s) => s.is_active).length;
  const pendingCount = pending.length;

  return (
    <View style={styles.wrap}>
      <Text variant="muted">Here&apos;s an overview of {schoolName}.</Text>

      <View style={styles.statGrid}>
        <StatCard
          icon={GraduationCap}
          value={activeYear ? activeYear.name : "-"}
          label="Active Year"
          loading={loading}
        />
        <StatCard
          icon={Users}
          value={activeStudents}
          label="Students"
          loading={loading}
        />
        <StatCard
          icon={UsersRound}
          value={members.length}
          label="Staff"
          loading={loading}
        />
        <StatCard
          icon={UserPlus}
          value={pendingCount}
          label="Pending"
          loading={loading}
        />
      </View>

      {pendingCount > 0 && (
        <Card style={{ borderColor: colors.primary }}>
          <CardContent style={styles.pendingRow}>
            <UserPlus size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text weight="600">
                {pendingCount} pending join{" "}
                {pendingCount === 1 ? "request" : "requests"}
              </Text>
              <Text variant="muted">
                Review and approve to add new members.
              </Text>
            </View>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Staff Composition</CardTitle>
          <CardDescription>Members of your school by role</CardDescription>
        </CardHeader>
        <CardContent>
          {staffData.length === 0 ? (
            <Text variant="muted" style={styles.empty}>
              No staff members yet.
            </Text>
          ) : (
            <DonutChart data={staffData} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Student Distribution</CardTitle>
          <CardDescription>Active students by gender</CardDescription>
        </CardHeader>
        <CardContent>
          {studentData.length === 0 ? (
            <Text variant="muted" style={styles.empty}>
              No active students yet.
            </Text>
          ) : (
            <DonutChart data={studentData} />
          )}
        </CardContent>
      </Card>

      {activeYear && (
        <Card>
          <CardHeader>
            <CardTitle>Current Academic Year</CardTitle>
            <CardDescription>{activeYear.name}</CardDescription>
          </CardHeader>
          <CardContent style={styles.yearRow}>
            <Text variant="muted">
              {formatDate(activeYear.start_date)} –{" "}
              {formatDate(activeYear.end_date)}
            </Text>
            <Badge variant="secondary">
              {capitalize(activeYear.grading_model.replace("_", " "))}
            </Badge>
          </CardContent>
        </Card>
      )}
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
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  empty: {
    textAlign: "center",
    paddingVertical: 24,
  },
  yearRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
});
