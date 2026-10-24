import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { TextArea } from "@/components/ui/TextArea";
import { Markdown } from "@/components/ui/Markdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { formatScore, roundScore } from "@/lib/format-number";
import { downloadAndOpen } from "@/lib/open-file";
import {
  errorMessage,
  href,
  type ActivityRubric,
  type RubricAssessment,
  type StaffActivity,
  type TeacherSubmissionRow,
} from "@/lib/course";
import { RubricView } from "@/features/course/RubricView";

/** A mark as typed: digits with at most two decimals. */
const SCORE_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Mark one student on one activity: read what they handed in (text, file),
 * give a score out of the activity's points with feedback, or excuse them.
 * When the activity has a rubric, picking a level per criterion fills the
 * score with their sum, which can still be overridden.
 */
export default function MarkSubmissionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const { courseId, activityId, studentId } = useLocalSearchParams<{
    courseId: string;
    activityId: string;
    studentId: string;
  }>();

  const [activity, setActivity] = useState<StaffActivity | null>(null);
  const [rows, setRows] = useState<TeacherSubmissionRow[]>([]);
  const [rubric, setRubric] = useState<ActivityRubric | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [score, setScore] = useState("");
  const [scoreTouched, setScoreTouched] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [picks, setPicks] = useState<RubricAssessment[]>([]);
  const [saving, setSaving] = useState(false);
  const [excusing, setExcusing] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);

  const row = rows.find((r) => r.studentId === studentId) ?? null;
  const index = rows.findIndex((r) => r.studentId === studentId);

  const load = useCallback(async () => {
    if (!activityId) return;
    const [a, subs] = await Promise.all([
      api<StaffActivity>(`/activities/${activityId}`).catch(() => null),
      api<TeacherSubmissionRow[]>(`/activities/${activityId}/submissions`).catch(
        () => null,
      ),
    ]);
    const r = a?.rubricId
      ? await api<ActivityRubric>(`/activities/${activityId}/rubric`).catch(
          () => null,
        )
      : null;
    setActivity(a);
    setRows(subs ?? []);
    setRubric(r);
    return { subs, r };
  }, [activityId]);

  /** Put the form back to what is saved for this student. */
  const resetForm = useCallback(
    (subs: TeacherSubmissionRow[] | null | undefined, r: ActivityRubric | null) => {
      const current = subs?.find((x) => x.studentId === studentId)?.submission;
      setScore(
        current?.score !== null && current?.score !== undefined
          ? String(roundScore(current.score))
          : "",
      );
      setScoreTouched(false);
      setFeedback(current?.feedback ?? "");
      setPicks(r?.assessments[studentId ?? ""] ?? []);
    },
    [studentId],
  );

  useEffect(() => {
    load()
      .then((res) => resetForm(res?.subs, res?.r ?? null))
      .finally(() => setLoading(false));
  }, [load, resetForm]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load()
      .then((res) => resetForm(res?.subs, res?.r ?? null))
      .finally(() => setRefreshing(false));
  }, [load, resetForm]);

  const rubricSum = useMemo(
    () => roundScore(picks.reduce((sum, p) => sum + (p.points ?? 0), 0)),
    [picks],
  );

  function pick(criterionId: string, ratingId: string, points: number) {
    const next = [
      ...picks.filter((p) => p.criterionId !== criterionId),
      { criterionId, ratingId, points, comment: null },
    ];
    setPicks(next);
    if (!scoreTouched) {
      setScore(
        String(roundScore(next.reduce((sum, p) => sum + (p.points ?? 0), 0))),
      );
    }
  }

  function go(offset: number) {
    const next = rows[index + offset];
    if (next) {
      router.replace(
        href(`/teaching/${courseId}/mark/${activityId}/${next.studentId}`),
      );
    }
  }

  async function save() {
    if (!activity) return;
    const typed = score.trim();
    if (!SCORE_RE.test(typed)) {
      toast.error("Enter a mark like 18 or 18.5 (at most two decimals)");
      return;
    }
    const value = Number(typed);
    if (value < 0 || value > activity.points) {
      toast.error(`The mark must be between 0 and ${formatScore(activity.points)}`);
      return;
    }

    setSaving(true);
    try {
      if (rubric?.rubric && picks.length > 0) {
        await api(`/activities/${activityId}/submissions/${studentId}/rubric`, {
          method: "PUT",
          body: {
            assessments: picks.map((p) => ({
              criterionId: p.criterionId,
              ratingId: p.ratingId,
              points: p.points,
              ...(p.comment ? { comment: p.comment } : {}),
            })),
            // Sent only when it differs from the levels' sum.
            ...(value !== rubricSum ? { score: value } : {}),
            feedback: feedback.trim(),
          },
        });
      } else {
        await api(`/activities/${activityId}/submissions/${studentId}/grade`, {
          method: "PATCH",
          body: { score: value, feedback: feedback.trim() },
        });
      }
      toast.success("Mark saved");
      const res = await load();
      resetForm(res?.subs, res?.r ?? null);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save the mark"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleExcuse() {
    const excused = !row?.submission?.excused;
    setExcusing(true);
    try {
      await api(`/activities/${activityId}/submissions/${studentId}/excuse`, {
        method: "PATCH",
        body: { excused },
      });
      toast.success(excused ? "Excused from this work" : "No longer excused");
      const res = await load();
      resetForm(res?.subs, res?.r ?? null);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update"));
    } finally {
      setExcusing(false);
    }
  }

  async function openFile() {
    const sub = row?.submission;
    if (!sub?.fileId) return;
    setOpeningFile(true);
    try {
      await downloadAndOpen(
        `/activities/submissions/${sub.id}/file`,
        sub.fileName ?? "submission",
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not open the file"));
    } finally {
      setOpeningFile(false);
    }
  }

  if (loading) {
    return (
      <Screen title="Mark" onBack={() => router.back()}>
        <Skeleton style={{ height: 160 }} />
        <Skeleton style={{ height: 220 }} />
      </Screen>
    );
  }

  if (!activity || !row) {
    return (
      <Screen
        title="Mark"
        description="This submission could not be loaded"
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View />
      </Screen>
    );
  }

  const sub = row.submission;
  const handedIn = !!sub && sub.status !== "draft";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        title={row.name}
        description={`${activity.title} · out of ${formatScore(activity.points)}`}
        onBack={() => router.back()}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        <View style={styles.nav}>
          <Button
            variant="outline"
            size="sm"
            disabled={index <= 0}
            onPress={() => go(-1)}
            icon={<ChevronLeft color={colors.foreground} size={16} />}
          >
            Previous
          </Button>
          <Text variant="muted" size="xs">
            {index + 1} of {rows.length}
          </Text>
          <Button
            variant="outline"
            size="sm"
            disabled={index < 0 || index >= rows.length - 1}
            onPress={() => go(1)}
          >
            <View style={styles.navNext}>
              <Text size="sm" weight="600">
                Next
              </Text>
              <ChevronRight color={colors.foreground} size={16} />
            </View>
          </Button>
        </View>

        <Card>
          <CardHeader style={styles.head}>
            <View style={{ flex: 1 }}>
              <CardTitle>Submission</CardTitle>
            </View>
            {sub?.excused ? (
              <Badge variant="secondary">Excused</Badge>
            ) : sub?.status === "graded" ? (
              <Badge variant="secondary">Marked</Badge>
            ) : handedIn ? (
              <Badge variant="default">Handed in</Badge>
            ) : (
              <Badge variant="outline">Not handed in</Badge>
            )}
          </CardHeader>
          <CardContent style={{ gap: 12, paddingTop: 8 }}>
            {sub?.submittedAt ? (
              <Text variant="muted" size="xs">
                Handed in {new Date(sub.submittedAt).toLocaleString()}
                {activity.kind === "quiz" && sub.attemptCount
                  ? ` · attempt ${sub.attemptCount}`
                  : ""}
              </Text>
            ) : null}
            {activity.kind === "offline" ? (
              <Text variant="muted" size="sm">
                Offline work: handed in on paper, marked here.
              </Text>
            ) : activity.kind === "quiz" ? (
              <Text variant="muted" size="sm">
                Quizzes mark themselves on submit. A mark entered here
                overrides the automatic score.
              </Text>
            ) : null}
            {sub?.textBody?.trim() ? (
              <View style={[styles.textBody, { backgroundColor: colors.muted }]}>
                <Text size="sm" selectable>
                  {sub.textBody}
                </Text>
              </View>
            ) : null}
            {sub?.fileId ? (
              <Button
                variant="outline"
                onPress={openFile}
                loading={openingFile}
                icon={<Paperclip color={colors.foreground} size={16} />}
              >
                {sub.fileName ?? "Open file"}
              </Button>
            ) : null}
            {!handedIn && activity.kind === "assignment" ? (
              <Text variant="muted" size="sm">
                Nothing handed in yet. You can still give a mark.
              </Text>
            ) : null}
          </CardContent>
        </Card>

        {rubric?.rubric ? (
          <Card>
            <CardHeader>
              <CardTitle>{rubric.rubric.title}</CardTitle>
            </CardHeader>
            <CardContent style={{ paddingTop: 8 }}>
              <RubricView
                rubric={rubric.rubric}
                assessments={picks}
                onSelect={pick}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Mark</CardTitle>
          </CardHeader>
          <CardContent style={{ gap: 14, paddingTop: 8 }}>
            <View style={{ gap: 6 }}>
              <Label>{`Score (0-${formatScore(activity.points)})`}</Label>
              <Input
                value={score}
                onChangeText={(v) => {
                  setScore(v.replace(",", "."));
                  setScoreTouched(true);
                }}
                keyboardType="decimal-pad"
                placeholder={`out of ${formatScore(activity.points)}`}
              />
              {rubric?.rubric && picks.length > 0 && Number(score) !== rubricSum ? (
                <Text variant="muted" size="xs">
                  Rubric levels add up to {formatScore(rubricSum)}; the score
                  above is used instead.
                </Text>
              ) : null}
            </View>
            <View style={{ gap: 6 }}>
              <Label>Feedback</Label>
              <TextArea
                value={feedback}
                onChangeText={setFeedback}
                numberOfLines={5}
                maxLength={2000}
                placeholder="What went well, what to work on"
              />
            </View>
            {feedback.trim() ? (
              <View style={{ gap: 4 }}>
                <Text variant="label">Preview</Text>
                <Markdown muted>{feedback}</Markdown>
              </View>
            ) : null}
            <Button onPress={save} loading={saving}>
              Save mark
            </Button>
            <Button
              variant="ghost"
              onPress={toggleExcuse}
              loading={excusing}
            >
              {sub?.excused ? "Remove excuse" : "Excuse from this work"}
            </Button>
          </CardContent>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  navNext: { flexDirection: "row", alignItems: "center", gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  textBody: { borderRadius: 10, padding: 12 },
});
