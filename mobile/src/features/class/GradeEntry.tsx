import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Eye, EyeOff, Save } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import type { EnrolledStudent, GradeRow } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users } from "lucide-react-native";

/** Grade-entry list for a selected assessment (scores + remarks + exclude). */
export function GradeEntry({
  assessmentId,
  maxScore,
  classId,
  subjectId,
}: {
  assessmentId: string;
  maxScore: number;
  classId: string;
  subjectId: string;
}) {
  const toast = useToast();
  const { colors } = useTheme();

  const [enrolled, setEnrolled] = useState<EnrolledStudent[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [scores, setScores] = useState<
    Record<string, { score: string; remarks: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [excluding, setExcluding] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<EnrolledStudent[]>(
        `/classes/${classId}/students?subjectId=${subjectId}`,
      ).catch(() => [] as EnrolledStudent[]),
      api<GradeRow[]>(`/grades?assessmentId=${assessmentId}`).catch(
        () => [] as GradeRow[],
      ),
    ])
      .then(([students, gradeRows]) => {
        setEnrolled(students);
        setGrades(gradeRows);
        const map: Record<string, { score: string; remarks: string }> = {};
        for (const g of gradeRows) {
          map[g.student_id] = {
            score: g.score !== null ? String(g.score) : "",
            remarks: g.remarks ?? "",
          };
        }
        setScores(map);
      })
      .finally(() => setLoading(false));
  }, [classId, subjectId, assessmentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const update = (
    studentId: string,
    field: "score" | "remarks",
    value: string,
  ) => {
    setScores((prev) => ({
      ...prev,
      [studentId]: {
        score: prev[studentId]?.score ?? "",
        remarks: prev[studentId]?.remarks ?? "",
        [field]: value,
      },
    }));
  };

  const save = async () => {
    const entries: { studentId: string; score: number; remarks?: string }[] = [];
    for (const e of enrolled) {
      const entry = scores[e.student.id];
      if (entry?.score !== undefined && entry.score !== "") {
        let n = Number(entry.score);
        if (isNaN(n)) continue;
        n = Math.max(0, Math.min(maxScore, n));
        entries.push({
          studentId: e.student.id,
          score: n,
          remarks: entry.remarks || undefined,
        });
      }
    }
    if (entries.length === 0) {
      toast.error("No scores to save");
      return;
    }
    setSaving(true);
    try {
      await api("/grades/bulk", {
        method: "POST",
        body: { assessmentId, grades: entries },
      });
      toast.success(`${entries.length} grade${entries.length > 1 ? "s" : ""} saved`);
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleExclude = async (grade: GradeRow) => {
    setExcluding(grade.id);
    try {
      await api(`/grades/${grade.id}/exclude`, {
        method: "PATCH",
        body: {
          isExcluded: !grade.is_excluded,
          exclusionReason: !grade.is_excluded ? "Excluded by teacher" : undefined,
        },
      });
      toast.success(grade.is_excluded ? "Grade included" : "Grade excluded");
      fetchData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setExcluding(null);
    }
  };

  if (loading) return <Skeleton style={{ height: 200, borderRadius: 12 }} />;

  if (enrolled.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No students enrolled"
        description="Enrol students in this subject to enter grades."
      />
    );
  }

  const sorted = [...enrolled].sort((a, b) =>
    a.student.last_name.localeCompare(b.student.last_name),
  );

  return (
    <View style={{ gap: 8 }}>
      {sorted.map((e) => {
        const entry = scores[e.student.id] ?? { score: "", remarks: "" };
        const grade = grades.find((g) => g.student_id === e.student.id);
        return (
          <Card key={e.student.id} style={grade?.is_excluded ? { opacity: 0.5 } : undefined}>
            <View style={styles.row}>
              <View style={styles.nameCol}>
                <Text weight="500">
                  {e.student.first_name} {e.student.last_name}
                </Text>
                {grade?.converted ? (
                  <Badge
                    variant={grade.converted.isPass ? "default" : "outline"}
                    color={grade.converted.isPass ? undefined : colors.destructive}
                  >
                    {grade.converted.label}
                  </Badge>
                ) : null}
              </View>
              <Input
                keyboardType="numeric"
                value={entry.score}
                onChangeText={(v) => update(e.student.id, "score", v)}
                placeholder={`/${maxScore}`}
                style={styles.scoreInput}
              />
              {grade ? (
                <Pressable
                  hitSlop={6}
                  disabled={excluding === grade.id}
                  onPress={() => toggleExclude(grade)}
                >
                  {grade.is_excluded ? (
                    <Eye size={18} color={colors.mutedForeground} />
                  ) : (
                    <EyeOff size={18} color={colors.mutedForeground} />
                  )}
                </Pressable>
              ) : null}
            </View>
            <Input
              value={entry.remarks}
              onChangeText={(v) => update(e.student.id, "remarks", v)}
              placeholder="Optional remarks"
              style={styles.remarks}
            />
          </Card>
        );
      })}
      <Button onPress={save} loading={saving} icon={<Save size={16} color={colors.primaryForeground} />}>
        Save All Grades
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  nameCol: {
    flex: 1,
    gap: 4,
    alignItems: "flex-start",
  },
  scoreInput: {
    width: 72,
    height: 40,
    textAlign: "center",
  },
  remarks: {
    marginHorizontal: 14,
    marginBottom: 14,
    marginTop: 10,
    height: 40,
  },
});
