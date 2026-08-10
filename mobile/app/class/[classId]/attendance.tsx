import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { BarChart3, Save } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { useClass } from "@/features/class/ClassContext";
import { StudentAttendanceReport } from "@/features/class/StudentAttendanceReport";
import type {
  AttendanceRosterEntry,
  AttendanceRosterResponse,
  AttendanceStatus,
} from "@/lib/types";
import { toIsoDate } from "@/components/ui/DateField";
import { DateField } from "@/components/ui/DateField";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusToggle } from "@/components/ui/StatusToggle";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users } from "lucide-react-native";

export default function AttendanceScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { classId, classInfo, loading: classLoading } = useClass();

  const [date, setDate] = useState(toIsoDate(new Date()));
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [rosterLoading, setRosterLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reportStudent, setReportStudent] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const canMark = classInfo?.isClassTeacher ?? false;

  const fetchRoster = useCallback(() => {
    setRosterLoading(true);
    api<AttendanceRosterResponse>(`/classes/${classId}/attendance?date=${date}`)
      .then((data) => {
        setRoster(data.entries);
        const next: Record<string, AttendanceStatus> = {};
        for (const e of data.entries) {
          if (e.record) next[e.studentId] = e.record.status;
        }
        setMarks(next);
      })
      .catch(() => {
        setRoster([]);
        setMarks({});
        toast.error("Failed to load roster");
      })
      .finally(() => setRosterLoading(false));
  }, [classId, date, toast]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = () => {
    const next: Record<string, AttendanceStatus> = {};
    for (const e of roster) next[e.studentId] = "present";
    setMarks(next);
  };

  const save = async () => {
    const entries = Object.entries(marks).map(([studentId, status]) => ({
      studentId,
      status,
    }));
    if (entries.length === 0) {
      toast.error("Mark at least one student before saving");
      return;
    }
    setSaving(true);
    try {
      await api(`/classes/${classId}/attendance/bulk`, {
        method: "POST",
        body: { date, entries },
      });
      toast.success(
        `Attendance saved for ${entries.length} student${entries.length === 1 ? "" : "s"}`,
      );
      fetchRoster();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  const totalMarked = Object.keys(marks).length;
  const totalStudents = roster.length;

  return (
    <Screen
      title="Attendance"
      description={
        classLoading
          ? undefined
          : canMark
            ? "Mark each student present, absent, or late"
            : "View attendance records"
      }
      onBack={() => router.back()}
      action={
        canMark && totalStudents > 0 ? (
          <Button
            size="sm"
            onPress={save}
            loading={saving}
            icon={<Save size={16} color={colors.primaryForeground} />}
          >
            Save
          </Button>
        ) : undefined
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardDescription>
            {totalStudents > 0
              ? `${totalMarked} of ${totalStudents} marked`
              : "No students enrolled"}
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16, paddingTop: 0 }}>
          <DateField value={date} onChange={setDate} maximumDate={new Date()} />
          {canMark && totalStudents > 0 ? (
            <Button variant="outline" size="sm" onPress={markAllPresent}>
              Mark all present
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {rosterLoading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 56, borderRadius: 12 }} />
          ))}
        </View>
      ) : totalStudents === 0 ? (
        <EmptyState
          icon={Users}
          title="No students enrolled"
          description="Students enrolled in this class will appear here."
        />
      ) : (
        <View style={{ gap: 8 }}>
          {roster.map((e) => (
            <Card key={e.studentId}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text weight="500">
                    {e.firstName} {e.lastName}
                  </Text>
                </View>
                <StatusToggle
                  value={marks[e.studentId]}
                  onChange={(s) => setStatus(e.studentId, s)}
                  disabled={!canMark}
                />
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    setReportStudent({
                      id: e.studentId,
                      name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
                    })
                  }
                >
                  <BarChart3 size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      )}

      <Sheet
        open={reportStudent !== null}
        onClose={() => setReportStudent(null)}
        title={`Attendance — ${reportStudent?.name || "Student"}`}
        description="Summary and recorded marks over a range"
      >
        {reportStudent ? (
          <StudentAttendanceReport
            classId={classId}
            studentId={reportStudent.id}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
});
