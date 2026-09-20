import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { CheckCircle2, Paperclip, Upload } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { attemptsLeft, dueLabel, type PortalWorkDetail } from "@/lib/work";
import { uploadSubmissionFile } from "@/lib/upload";

export default function WorkDetailScreen() {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { colors } = useTheme();
  const toast = useToast();

  const [work, setWork] = useState<PortalWorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** questionId -> chosen optionId */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** questionId -> typed answer, for short-answer questions */
  const [written, setWritten] = useState<Record<string, string>>({});
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    if (!activityId) return;
    const data = await api<PortalWorkDetail>(
      `/portal/me/activities/${activityId}`,
    ).catch(() => null);
    setWork(data);
    setText(data?.submission?.textBody ?? "");
  }, [activityId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function submitQuiz() {
    if (!work) return;

    const unanswered = work.questions.filter((q) =>
      q.kind === "short_answer" ? !written[q.id]?.trim() : !answers[q.id],
    );
    if (unanswered.length > 0) {
      toast.error(`Answer every question first (${unanswered.length} left)`);
      return;
    }

    setWorking(true);
    try {
      const result = await api<{ score: number; points: number }>(
        `/portal/me/activities/${activityId}/quiz`,
        {
          method: "POST",
          body: {
            answers: work.questions.map((q) =>
              q.kind === "short_answer"
                ? { questionId: q.id, text: written[q.id]?.trim() ?? "" }
                : { questionId: q.id, optionId: answers[q.id] },
            ),
          },
        },
      );
      toast.success(`Submitted — you scored ${result.score}/${result.points}`);
      // A retake starts blank rather than pre-filled with the last attempt.
      setAnswers({});
      setWritten({});
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setWorking(false);
    }
  }

  async function submitAssignment() {
    const attached = !!work?.submission?.fileId;
    if (!text.trim() && !attached) {
      toast.error("Add your work before handing in");
      return;
    }

    setWorking(true);
    try {
      await api(`/portal/me/activities/${activityId}/submit`, {
        method: "POST",
        body: { textBody: text.trim() || undefined },
      });
      toast.success("Handed in");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to hand in");
    } finally {
      setWorking(false);
    }
  }

  async function attachFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    setUploading(true);
    try {
      await uploadSubmissionFile(activityId!, {
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? 0,
        mimeType: asset.mimeType ?? "application/octet-stream",
      });
      toast.success("File attached — hand in when you are ready");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to upload",
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <Screen title="Work" onBack={() => router.back()}>
        <Skeleton style={{ height: 120 }} />
        <Skeleton style={{ height: 220, marginTop: 12 }} />
      </Screen>
    );
  }

  if (!work) {
    return (
      <Screen
        title="Work"
        description="This could not be loaded"
        onBack={() => router.back()}
      >
        <View />
      </Screen>
    );
  }

  const submitted = !!work.submission && work.submission.status !== "draft";
  const left = attemptsLeft(work);
  const canRetake = left !== null && left > 0;
  const open = work.status === "published" && (!submitted || canRetake);

  return (
    <Screen
      title={work.title}
      description={`${work.points} points · ${dueLabel(work.dueAt)}`}
      onBack={() => router.back()}
    >
      <View style={{ gap: 12 }}>
        {submitted && (
          <Card>
            <CardContent style={styles.result}>
              <CheckCircle2 color={colors.primary} size={20} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="500">
                  {work.submission?.status === "graded"
                    ? `Marked: ${work.submission.score}/${work.points}`
                    : "Handed in"}
                </Text>
                {work.submission?.feedback ? (
                  <Text variant="muted" size="xs">
                    {work.submission.feedback}
                  </Text>
                ) : null}
                {canRetake && (
                  <Text variant="muted" size="xs">
                    {left === Infinity
                      ? "You can try this again as often as you like."
                      : `You can try again — ${left} attempt${left === 1 ? "" : "s"} left.`}
                  </Text>
                )}
              </View>
            </CardContent>
          </Card>
        )}

        {work.instructions ? (
          <Card>
            <CardContent>
              <Text variant="muted" size="sm">
                {work.instructions}
              </Text>
            </CardContent>
          </Card>
        ) : null}

        {work.kind === "quiz" ? (
          <View style={{ gap: 12 }}>
            {work.questions.map((q, i) => (
              <Card key={q.id}>
                <CardHeader style={styles.questionHeader}>
                  <View style={{ flex: 1 }}>
                    <CardTitle>
                      {i + 1}. {q.prompt}
                    </CardTitle>
                  </View>
                  <Badge variant="secondary">{q.points} pt</Badge>
                </CardHeader>
                <CardContent style={{ gap: 8 }}>
                  {q.kind === "short_answer" ? (
                    <Input
                      placeholder="Type your answer"
                      value={written[q.id] ?? ""}
                      editable={open}
                      onChangeText={(value) =>
                        setWritten((prev) => ({ ...prev, [q.id]: value }))
                      }
                    />
                  ) : (
                    q.options.map((o) => {
                      const chosen = answers[q.id] === o.id;
                      return (
                        <Pressable
                          key={o.id}
                          disabled={!open}
                          onPress={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: o.id }))
                          }
                          style={({ pressed }) => [
                            styles.option,
                            {
                              borderColor: chosen ? colors.primary : colors.border,
                              backgroundColor: chosen
                                ? colors.muted
                                : "transparent",
                              opacity: pressed || !open ? 0.7 : 1,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.radio,
                              {
                                borderColor: chosen
                                  ? colors.primary
                                  : colors.border,
                                backgroundColor: chosen
                                  ? colors.primary
                                  : "transparent",
                              },
                            ]}
                          />
                          <Text size="sm" weight={chosen ? "500" : "400"}>
                            {o.label}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            ))}

            {open && (
              <>
                <Button onPress={submitQuiz} loading={working}>
                  {submitted ? "Try again" : "Submit quiz"}
                </Button>
                <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                  {work.maxAttempts === 0
                    ? "Marked as soon as you submit, and you can retake it."
                    : work.maxAttempts === 1
                      ? "You get one attempt, and it is marked as soon as you submit."
                      : `You get ${work.maxAttempts} attempts, and only the latest counts.`}
                </Text>
              </>
            )}
          </View>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Your work</CardTitle>
            </CardHeader>
            <CardContent style={{ gap: 12 }}>
              {work.allowText ? (
                <TextArea
                  placeholder="Type your answer here"
                  value={text}
                  editable={open}
                  onChangeText={setText}
                  style={{ minHeight: 140 }}
                />
              ) : (
                <Text variant="muted" size="sm">
                  This assignment is handed in as a file.
                </Text>
              )}

              {work.allowFile && (
                <View style={{ gap: 8 }}>
                  {work.submission?.fileId ? (
                    <View
                      style={[styles.attached, { borderColor: colors.border }]}
                    >
                      <Paperclip color={colors.mutedForeground} size={16} />
                      <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
                        {work.submission.fileName ?? "Attached file"}
                      </Text>
                    </View>
                  ) : null}

                  {open && (
                    <>
                      <Button
                        variant="outline"
                        onPress={attachFile}
                        loading={uploading}
                        icon={<Upload color={colors.foreground} size={16} />}
                      >
                        {work.submission?.fileId
                          ? "Replace file"
                          : "Attach a file"}
                      </Button>
                      <Text variant="muted" size="xs">
                        Up to 10MB, and an interrupted upload picks up where it
                        stopped. Attaching a file does not hand it in.
                      </Text>
                    </>
                  )}
                </View>
              )}

              {open && (
                <Button onPress={submitAssignment} loading={working}>
                  Hand in
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {work.status === "closed" && !submitted && (
          <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
            This closed before you handed anything in.
          </Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { flexDirection: "row", alignItems: "center", gap: 12 },
  questionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attached: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
