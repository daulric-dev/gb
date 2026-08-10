import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { useClass } from "@/features/class/ClassContext";
import { AssessmentForm } from "@/features/class/AssessmentForm";
import { GradeEntry } from "@/features/class/GradeEntry";
import type { Assessment, Subject, Term } from "@/lib/types";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Text";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const TERM_LABELS: Record<string, string> = {
  michaelmas: "Michaelmas",
  hilary: "Hilary",
  trinity: "Trinity",
};

export default function GradingScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { classId, classInfo } = useClass();

  const [terms, setTerms] = useState<Term[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [termId, setTermId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessLoading, setAssessLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Assessment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Assessment | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load subjects + terms once the class is known.
  useEffect(() => {
    if (!classInfo) return;
    Promise.all([
      api<Subject[]>(`/classes/${classId}/my-subjects`).catch(() => [] as Subject[]),
      api<Term[]>(`/terms?yearId=${classInfo.academicYearId}`).catch(
        () => [] as Term[],
      ),
    ]).then(([subs, t]) => {
      setSubjects(subs);
      setTerms(t);
      if (subs.length > 0) setSubjectId(subs[0].id);
      if (t.length > 0) setTermId(t[0].id);
      setLoading(false);
    });
  }, [classId, classInfo]);

  const fetchAssessments = useCallback(() => {
    if (!termId || !subjectId) return;
    setAssessLoading(true);
    api<Assessment[]>(`/assessments?termId=${termId}&subjectId=${subjectId}`)
      .then((data) => {
        setAssessments(data);
        setSelected((cur) =>
          cur ? (data.find((a) => a.id === cur.id) ?? data[0] ?? null) : (data[0] ?? null),
        );
      })
      .catch(() => toast.error("Failed to load assessments"))
      .finally(() => setAssessLoading(false));
  }, [termId, subjectId, toast]);

  useEffect(() => {
    fetchAssessments();
  }, [fetchAssessments]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/assessments/${confirmDelete.id}`, { method: "DELETE" });
      toast.success("Assessment deleted");
      setSelected(null);
      setConfirmDelete(null);
      fetchAssessments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const toggleExclude = async (a: Assessment) => {
    try {
      await api(`/assessments/${a.id}/exclude`, {
        method: "PATCH",
        body: {
          isExcluded: !a.is_excluded,
          exclusionReason: !a.is_excluded ? "Excluded by teacher" : undefined,
        },
      });
      toast.success(a.is_excluded ? "Assessment included" : "Assessment excluded");
      fetchAssessments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  return (
    <Screen title="Grading" description={classInfo?.name} onBack={() => router.back()}>
      {loading ? (
        <Skeleton style={{ height: 120, borderRadius: 12 }} />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>Term</Label>
              <Select
                value={termId}
                onChange={(v) => {
                  setTermId(v);
                  setSelected(null);
                }}
                options={terms.map((t) => ({
                  value: t.id,
                  label: TERM_LABELS[t.name] ?? t.name,
                }))}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Label>Subject</Label>
              <Select
                value={subjectId}
                onChange={(v) => {
                  setSubjectId(v);
                  setSelected(null);
                }}
                options={subjects.map((s) => ({
                  value: s.id,
                  label: s.code ? `${s.name} (${s.code})` : s.name,
                }))}
              />
            </View>
          </View>

          <Card>
            <CardHeader style={styles.assessHeader}>
              <View style={{ flex: 1 }}>
                <CardTitle>Assessments</CardTitle>
                <CardDescription>
                  {assessments.length} assessment
                  {assessments.length !== 1 ? "s" : ""}
                </CardDescription>
              </View>
              <Button
                size="sm"
                disabled={!termId || !subjectId}
                onPress={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                icon={<Plus size={16} color={colors.primaryForeground} />}
              >
                New
              </Button>
            </CardHeader>
            <CardContent style={{ paddingTop: 0 }}>
              {assessLoading ? (
                <Skeleton style={{ height: 60, borderRadius: 10 }} />
              ) : assessments.length === 0 ? (
                <Text variant="muted">
                  No assessments yet. Create one to start entering grades.
                </Text>
              ) : (
                <View style={styles.chips}>
                  {assessments.map((a) => {
                    const active = selected?.id === a.id;
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => setSelected(a)}
                        style={[
                          styles.chip,
                          {
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.accent : "transparent",
                            opacity: a.is_excluded ? 0.5 : 1,
                          },
                        ]}
                      >
                        <Text weight="600" style={{ fontSize: 13 }}>
                          {a.title}
                        </Text>
                        <Text variant="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {a.assessment_type} · /{a.max_score}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </CardContent>
          </Card>

          {selected ? (
            <Card>
              <CardHeader style={styles.assessHeader}>
                <View style={{ flex: 1 }}>
                  <CardTitle>{selected.title}</CardTitle>
                  <CardDescription>
                    Max {selected.max_score} · Weight {selected.weight}
                    {selected.is_excluded ? " · Excluded" : ""}
                  </CardDescription>
                </View>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <IconBtn onPress={() => toggleExclude(selected)}>
                    {selected.is_excluded ? (
                      <Eye size={18} color={colors.mutedForeground} />
                    ) : (
                      <EyeOff size={18} color={colors.mutedForeground} />
                    )}
                  </IconBtn>
                  <IconBtn
                    onPress={() => {
                      setEditing(selected);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil size={18} color={colors.mutedForeground} />
                  </IconBtn>
                  <IconBtn onPress={() => setConfirmDelete(selected)}>
                    <Trash2 size={18} color={colors.destructive} />
                  </IconBtn>
                </View>
              </CardHeader>
              <CardContent style={{ paddingTop: 0 }}>
                <GradeEntry
                  key={selected.id}
                  assessmentId={selected.id}
                  maxScore={selected.max_score}
                  classId={classId}
                  subjectId={subjectId}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Assessment" : "Create Assessment"}
      >
        <AssessmentForm
          assessment={editing ?? undefined}
          termId={termId}
          subjectId={subjectId}
          onSuccess={() => {
            setFormOpen(false);
            fetchAssessments();
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete assessment?"
        message={`"${confirmDelete?.title}" and all its grades will be removed.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </Screen>
  );
}

function IconBtn({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  assessHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  iconBtn: {
    padding: 6,
  },
});
