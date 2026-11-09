import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { CheckCircle2, Paperclip, Upload } from "lucide-react-native";
import { api } from "@/lib/api";
import { Screen } from "@/components/layout/Screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import {
  attemptsLeft,
  dueLabel,
  lateDays,
  pastDueMessage,
  studentDueAt,
  type PortalWorkDetail,
} from "@/lib/work";
import { uploadSubmissionFile } from "@/lib/upload";
import { formatMb, uploadSizeError, useUploadLimit } from "@/lib/upload-limit";
import { formatScore } from "@/lib/format-number";
import { Markdown } from "@/components/ui/Markdown";
import { RubricView } from "@/features/course/RubricView";
import { userMessage } from "@/lib/errors";
import { useQuizLockdown } from "@/lib/use-quiz-lockdown";
import { PINNING_PLATFORM, useAppPinning } from "@/lib/use-app-pinning";
import { quizMinutesLabel } from "@/lib/accommodations";
import {
  LockdownOverlay,
  LockdownStartCard,
  UnpinCard,
} from "@/features/work/QuizLockdown";

export default function WorkDetailScreen() {
  const router = useRouter();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { colors } = useTheme();
  const toast = useToast();

  const [work, setWork] = useState<PortalWorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [submitConfirmation, setSubmitConfirmation] = useState(false);
  const [quizSaveState, setQuizSaveState] = useState<
    "saved" | "saving" | "error"
  >("saved");
  const [clock, setClock] = useState(Date.now());
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [uploading, setUploading] = useState(false);
  // The school's upload limit, for the hint and a check before the tickets.
  const uploadLimit = useUploadLimit();
  /** questionId -> chosen optionId */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** questionId -> typed answer, for short-answer questions */
  const [written, setWritten] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  // Lockdown pinning: a failed pin offers the reported "without pinning"
  // fallback; waived reports not_pinned for the attempt; unpinHint shows how
  // to end a pin the app could not release itself.
  const [pinBusy, setPinBusy] = useState(false);
  const [pinFailed, setPinFailed] = useState(false);
  const [pinningWaived, setPinningWaived] = useState(false);
  const [unpinHint, setUnpinHint] = useState(false);
  const quizSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quizSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const quizSaveRevision = useRef(0);
  const quizSavedRevision = useRef(0);
  const timeoutHandled = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!activityId) return;
    const data = await api<PortalWorkDetail>(
      `/portal/me/activities/${activityId}`,
    ).catch(() => null);
    setWork(data);
    setText(data?.submission?.textBody ?? "");
    setServerClockOffset(
      data?.quizAttempt
        ? Date.parse(data.quizAttempt.serverNow) - Date.now()
        : 0,
    );
    setAnswers(
      Object.fromEntries(
        (data?.quizAttempt?.answers ?? []).flatMap((answer) =>
          answer.optionId ? [[answer.questionId, answer.optionId]] : [],
        ),
      ),
    );
    setWritten(
      Object.fromEntries(
        (data?.quizAttempt?.answers ?? []).flatMap((answer) =>
          answer.text !== null ? [[answer.questionId, answer.text]] : [],
        ),
      ),
    );
    quizSaveRevision.current = 0;
    quizSavedRevision.current = 0;
    setQuizSaveState("saved");
  }, [activityId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const deadline = work?.quizAttempt?.expiresAt ?? null;
  useEffect(() => {
    if (!deadline) return;
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const secondsRemaining = deadline
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(deadline) - (clock + serverClockOffset)) / 1000,
        ),
      )
    : null;

  const lockdownQuiz = !!work?.lockdownBrowser && work.kind === "quiz";
  const pinning = useAppPinning(lockdownQuiz);
  // Lockdown quizzes: monitored only while an attempt can still be answered.
  const lockdownActive =
    lockdownQuiz &&
    work?.status === "published" &&
    !!work.quizAttempt?.startedAt &&
    secondsRemaining !== 0;
  const lockdown = useQuizLockdown({
    activityId,
    enabled: lockdownActive,
    pinned: pinning.pinned,
    captured: pinning.captured,
    pinningRequired: PINNING_PLATFORM !== null,
    pinningWaived,
    onScreenshot: () =>
      toast.error("Screenshot reported to your teacher."),
  });

  // Release the pin when the attempt ends (submit or expiry) and on leaving
  // the screen. iOS cannot end a Guided Access session the student started,
  // so they are told how.
  const stopPinning = pinning.stopPinning;
  const lockdownWasActive = useRef(false);
  useEffect(() => {
    if (lockdownActive) {
      lockdownWasActive.current = true;
      setUnpinHint(false);
      return;
    }
    if (!lockdownWasActive.current) return;
    lockdownWasActive.current = false;
    setPinningWaived(false);
    setPinFailed(false);
    void stopPinning().then((unpinned) => setUnpinHint(!unpinned));
  }, [lockdownActive, stopPinning]);
  useEffect(
    () => () => {
      void stopPinning();
    },
    [stopPinning],
  );

  /** Pin first (Android prompt / iOS managed Guided Access), then start. */
  async function startLockdownQuiz() {
    if (!pinning.pinned) {
      setPinBusy(true);
      const pinned = await pinning.startPinning();
      setPinBusy(false);
      setPinFailed(!pinned);
      if (!pinned) return;
    }
    setPinningWaived(false);
    await startQuiz();
  }

  async function startWithoutPinning() {
    setPinningWaived(true);
    await startQuiz();
  }

  async function pinAgain() {
    setPinBusy(true);
    const pinned = await pinning.startPinning();
    setPinBusy(false);
    setPinFailed(!pinned);
    if (pinned) setPinningWaived(false);
  }

  function quizAnswers(
    currentAnswers = answers,
    currentWritten = written,
  ) {
    if (!work) return [];
    return work.questions.reduce<
      { questionId: string; optionId?: string; text?: string }[]
    >((collected, question) => {
      if (question.kind === "short_answer") {
        const answer = currentWritten[question.id]?.trim();
        if (answer) collected.push({ questionId: question.id, text: answer });
        return collected;
      }
      const optionId = currentAnswers[question.id];
      if (optionId) collected.push({ questionId: question.id, optionId });
      return collected;
    }, []);
  }

  function persistQuizAnswers(
    revision: number,
    snapshot: ReturnType<typeof quizAnswers>,
  ) {
    const save = quizSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        await api(`/portal/me/activities/${activityId}/quiz/answers`, {
          method: "POST",
          body: { answers: snapshot },
        });
        quizSavedRevision.current = Math.max(
          quizSavedRevision.current,
          revision,
        );
        if (quizSaveRevision.current === revision) {
          setQuizSaveState("saved");
        }
      });
    quizSaveQueue.current = save;
    return save;
  }

  function scheduleQuizSave(
    nextAnswers = answers,
    nextWritten = written,
  ) {
    if (!work?.quizAttempt?.startedAt) return;
    const revision = ++quizSaveRevision.current;
    const snapshot = quizAnswers(nextAnswers, nextWritten);
    setQuizSaveState("saving");
    if (quizSaveTimer.current) clearTimeout(quizSaveTimer.current);
    quizSaveTimer.current = setTimeout(() => {
      quizSaveTimer.current = null;
      void persistQuizAnswers(revision, snapshot).catch(() => {
        if (quizSaveRevision.current === revision) setQuizSaveState("error");
      });
    }, 400);
  }

  async function flushQuizSave() {
    if (quizSaveTimer.current) {
      clearTimeout(quizSaveTimer.current);
      quizSaveTimer.current = null;
    }
    if (quizSaveRevision.current > quizSavedRevision.current) {
      await persistQuizAnswers(
        quizSaveRevision.current,
        quizAnswers(),
      );
    } else {
      await quizSaveQueue.current;
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        void flushQuizSave();
      }
    });
    return () => {
      subscription.remove();
      if (quizSaveTimer.current) clearTimeout(quizSaveTimer.current);
      void flushQuizSave();
    };
  }, []);

  useEffect(() => {
    if (
      !deadline ||
      secondsRemaining !== 0 ||
      timeoutHandled.current === deadline
    ) {
      return;
    }
    timeoutHandled.current = deadline;
    setSubmitConfirmation(false);
    if (quizSaveTimer.current) {
      clearTimeout(quizSaveTimer.current);
      quizSaveTimer.current = null;
    }
    void quizSaveQueue.current
      .catch(() => undefined)
      .then(() =>
        api(`/portal/me/activities/${activityId}/quiz`, {
          method: "POST",
          body: { answers: [] },
        }),
      )
      .then(async () => {
        toast.success("Time is up — your saved answers were submitted.");
        await load();
      })
      .catch((err) => {
        toast.error(
          userMessage(err, "Time is up; the server will submit your saved answers."),
        );
        void load();
      });
  }, [activityId, deadline, secondsRemaining, load]);

  async function startQuiz() {
    setWorking(true);
    try {
      await api(`/portal/me/activities/${activityId}/quiz/start`, {
        method: "POST",
        body: {},
      });
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Could not start quiz"));
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function submitQuiz() {
    if (!work) return;

    setWorking(true);
    try {
      await flushQuizSave();
      const result = await api<{ score: number; points: number }>(
        `/portal/me/activities/${activityId}/quiz`,
        {
          method: "POST",
          body: {
            answers: quizAnswers(),
          },
        },
      );
      toast.success(
        `Submitted — you scored ${formatScore(result.score)}/${formatScore(result.points)}`,
      );
      // A retake starts blank rather than pre-filled with the last attempt.
      setAnswers({});
      setWritten({});
      setSubmitConfirmation(false);
      setSubmitConfirmation(false);
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to submit"));
    } finally {
      setWorking(false);
    }
  }

  async function submitAssignment() {
    const attached = !!(
      work?.submission?.files?.length || work?.submission?.fileId
    );
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
      toast.error(userMessage(err, "Failed to hand in"));
    } finally {
      setWorking(false);
    }
  }

  async function attachFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: work?.allowMultipleFiles ?? false,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    for (const asset of picked.assets) {
      const tooLarge = uploadSizeError(asset.size, uploadLimit?.uploadLimitBytes);
      if (tooLarge) {
        toast.error(`${asset.name}: ${tooLarge}`);
        return;
      }
    }

    setUploading(true);
    try {
      for (const asset of picked.assets) {
        await uploadSubmissionFile(activityId!, {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? "application/octet-stream",
        });
      }
      toast.success(
        `${picked.assets.length} file${picked.assets.length === 1 ? "" : "s"} attached — hand in when you are ready`,
      );
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to upload"));
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
  const offline = work.kind === "offline";
  // isClosed: past the student's due date, outside a running quiz attempt.
  const open =
    !offline &&
    work.status === "published" &&
    !work.isClosed &&
    (!submitted || canRetake);
  const quizInProgress = !!work.quizAttempt?.startedAt;
  const canStartQuiz = open && !quizInProgress;
  const quizCanAnswer =
    open && quizInProgress && secondsRemaining !== 0;
  const submissionFiles = work.submission?.files?.length
    ? work.submission.files
    : work.submission?.fileId
      ? [
          {
            id: work.submission.fileId,
            name: work.submission.fileName ?? "Attached file",
          },
        ]
      : [];
  const submittedLateBy =
    work.kind === "assignment"
      ? lateDays(studentDueAt(work), work.submission?.submittedAt ?? null)
      : null;
  const unansweredQuestions = work.questions
    .map((question, index) => ({
      question,
      number: index + 1,
      answered:
        question.kind === "short_answer"
          ? !!written[question.id]?.trim()
          : !!answers[question.id],
    }))
    .filter((item) => !item.answered);
  const unansweredQuestionIds = new Set(
    unansweredQuestions.map(({ question }) => question.id),
  );
  const answeredCount = work.questions.length - unansweredQuestions.length;
  const attemptWarning =
    work.maxAttempts === 0
      ? "You can retake this quiz as often as you like."
      : work.attemptsUsed + 1 >= work.maxAttempts
        ? "This uses your last attempt. You will not be able to change your answers after submitting."
        : `This uses one of your ${work.maxAttempts} attempts. Only your latest attempt counts.`;

  return (
    <Screen
      title={work.title}
      description={[
        work.courseName,
        `${formatScore(work.points)} points`,
        dueLabel(studentDueAt(work)) +
          (work.hasExtension ? " (extended)" : ""),
      ]
        .filter(Boolean)
        .join(" · ")}
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={{ gap: 12 }}>
        {submitted && (
          <Card>
            <CardContent style={styles.result}>
              <CheckCircle2 color={colors.primary} size={20} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="500">
                  {work.submission?.excused
                    ? "Excused"
                    : work.submission?.status === "graded"
                      ? `Marked: ${formatScore(work.submission.score)}/${formatScore(work.points)}`
                      : "Handed in"}
                </Text>
                {submittedLateBy !== null && (
                  <Text
                    variant="muted"
                    size="xs"
                    style={{ color: colors.mutedForeground }}
                  >
                    Submitted {submittedLateBy}{" "}
                    {submittedLateBy === 1 ? "day" : "days"} late
                  </Text>
                )}
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

        {work.submission?.feedback?.trim() ? (
          <Card>
            <CardHeader>
              <CardTitle>Feedback</CardTitle>
            </CardHeader>
            <CardContent style={{ paddingTop: 4 }}>
              <Markdown>{work.submission.feedback}</Markdown>
            </CardContent>
          </Card>
        ) : null}

        {work.instructions ? (
          <Card>
            <CardContent>
              <Markdown>{work.instructions}</Markdown>
            </CardContent>
          </Card>
        ) : null}

        {work.rubric ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {work.rubricAssessment?.length ? "How this was marked" : "Rubric"}
              </CardTitle>
            </CardHeader>
            <CardContent style={{ paddingTop: 4 }}>
              <RubricView
                rubric={work.rubric}
                assessments={work.rubricAssessment}
              />
            </CardContent>
          </Card>
        ) : null}

        {offline ? (
          !submitted ? (
            <Card>
              <CardContent style={{ gap: 4 }}>
                <Text weight="500">Handed in on paper</Text>
                <Text variant="muted" size="sm">
                  Your teacher records the mark here.
                </Text>
              </CardContent>
            </Card>
          ) : null
        ) : work.kind === "quiz" ? (
          <View style={{ gap: 12 }}>
            {canStartQuiz && work.lockdownBrowser && (
              <LockdownStartCard
                details={`${
                  work.timeLimitMinutes
                    ? `You have ${quizMinutesLabel(work.timeLimitMinutes, work.standardTimeLimitMinutes)}, and the timer keeps running if you leave.`
                    : "Your answers are saved as you work."
                }${
                  work.maxAttempts === 0
                    ? " Retakes are unlimited."
                    : ` ${left} attempt${left === 1 ? "" : "s"} available.`
                }`}
                startLabel={submitted ? "Start another attempt" : "Start quiz"}
                busy={working || pinBusy}
                platform={PINNING_PLATFORM}
                pinned={pinning.pinned}
                pinFailed={pinFailed}
                onStart={() => {
                  void startLockdownQuiz();
                }}
                onStartWithoutPinning={() => {
                  void startWithoutPinning();
                }}
              />
            )}
            {work.lockdownBrowser &&
              !lockdownActive &&
              unpinHint &&
              pinning.pinned && <UnpinCard platform={PINNING_PLATFORM} />}
            {canStartQuiz && !work.lockdownBrowser && (
              <Card>
                <CardContent style={{ gap: 8 }}>
                  <Text weight="500">
                    {submitted ? "Ready for another attempt?" : "Ready to begin?"}
                  </Text>
                  <Text variant="muted" size="sm">
                    {work.timeLimitMinutes
                      ? `You have ${quizMinutesLabel(work.timeLimitMinutes, work.standardTimeLimitMinutes)}. The timer starts when you begin and continues if you leave the quiz.`
                      : "Your answers are saved as you work. You can leave and return to this attempt."}
                    {work.maxAttempts === 0
                      ? " Retakes are unlimited."
                      : ` ${left} attempt${left === 1 ? "" : "s"} available.`}
                  </Text>
                  <Button onPress={startQuiz} loading={working}>
                    {submitted ? "Start another attempt" : "Start quiz"}
                  </Button>
                </CardContent>
              </Card>
            )}
            {quizInProgress && (
              <Card>
                <CardContent style={styles.timerCard}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text weight="500">
                      {secondsRemaining === null
                        ? "Your progress is saved automatically"
                        : "Time remaining"}
                    </Text>
                    <Text variant="muted" size="xs">
                      {quizSaveState === "saving"
                        ? "Saving answers..."
                        : quizSaveState === "error"
                          ? "Could not save your latest answers."
                          : "All changes saved"}
                    </Text>
                  </View>
                  {secondsRemaining !== null && (
                    <Text
                      accessibilityLabel="Time remaining"
                      accessibilityLiveRegion={
                        secondsRemaining <= 60 ? "assertive" : "none"
                      }
                      style={styles.timer}
                      weight="600"
                    >
                      {Math.floor(secondsRemaining / 60)}:
                      {String(secondsRemaining % 60).padStart(2, "0")}
                    </Text>
                  )}
                  {quizSaveState === "error" && (
                    <Button
                      variant="outline"
                      onPress={() => scheduleQuizSave()}
                    >
                      Retry save
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
            {quizInProgress && (
              <Card>
                <CardContent style={{ gap: 8 }}>
                  <View style={styles.progressLabel}>
                    <Text weight="500">Your progress</Text>
                    <Text variant="muted" size="sm">
                      {answeredCount} of {work.questions.length} answered
                    </Text>
                  </View>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Quiz answer progress"
                    accessibilityValue={{
                      min: 0,
                      max: work.questions.length,
                      now: answeredCount,
                    }}
                    style={[
                      styles.progressTrack,
                      { backgroundColor: colors.muted },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: colors.primary,
                          width: `${
                            work.questions.length
                              ? (answeredCount / work.questions.length) * 100
                              : 0
                          }%`,
                        },
                      ]}
                    />
                  </View>
                  {unansweredQuestions.length > 0 && (
                    <Text variant="muted" size="xs">
                      Still to answer:{" "}
                      {unansweredQuestions.map(({ number }) => number).join(", ")}
                    </Text>
                  )}
                </CardContent>
              </Card>
            )}
            {(quizInProgress || !open) && work.questions.map((q, i) => (
              <Card key={q.id}>
                <CardHeader style={styles.questionHeader}>
                  <View style={{ flex: 1 }}>
                    <CardTitle>
                      {i + 1}. {q.prompt}
                    </CardTitle>
                  </View>
                  <View style={styles.questionBadges}>
                    {quizCanAnswer && unansweredQuestionIds.has(q.id) && (
                      <Badge variant="outline">Not answered</Badge>
                    )}
                    <Badge variant="secondary">{`${formatScore(q.points)} pt`}</Badge>
                  </View>
                </CardHeader>
                <CardContent style={{ gap: 8 }}>
                  {q.kind === "short_answer" ? (
                    <Input
                      placeholder="Type your answer"
                      value={written[q.id] ?? ""}
                      editable={quizCanAnswer}
                      contextMenuHidden={lockdown.state.active}
                      onChangeText={(value) => {
                        const nextWritten = { ...written, [q.id]: value };
                        setWritten(nextWritten);
                        scheduleQuizSave(answers, nextWritten);
                      }}
                    />
                  ) : (
                    q.options.map((o) => {
                      const chosen = answers[q.id] === o.id;
                      return (
                        <Pressable
                          key={o.id}
                          disabled={!quizCanAnswer}
                          onPress={() => {
                            const nextAnswers = { ...answers, [q.id]: o.id };
                            setAnswers(nextAnswers);
                            scheduleQuizSave(nextAnswers, written);
                          }}
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

            {open && quizInProgress && (
              <>
                <Button
                  onPress={() => {
                    if (unansweredQuestions.length > 0) {
                      toast.error(
                        `Answer all questions before submitting (${unansweredQuestions.length} left: ${unansweredQuestions.map(({ number }) => number).join(", ")}).`,
                      );
                      return;
                    }
                    if (quizSaveState === "error") {
                      toast.error("Save your latest answers before submitting.");
                      return;
                    }
                    setSubmitConfirmation(true);
                  }}
                  loading={working}
                  disabled={secondsRemaining === 0}
                >
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
                  {submissionFiles.map((file) => (
                    <View
                      key={file.id}
                      style={[styles.attached, { borderColor: colors.border }]}
                    >
                      <Paperclip color={colors.mutedForeground} size={16} />
                      <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
                        {file.name}
                      </Text>
                    </View>
                  ))}

                  {open &&
                    (work.allowMultipleFiles || submissionFiles.length === 0) && (
                      <>
                        <Button
                          variant="outline"
                          onPress={attachFile}
                          loading={uploading}
                          icon={<Upload color={colors.foreground} size={16} />}
                        >
                          {submissionFiles.length > 0
                            ? "Add files"
                            : "Attach files"}
                        </Button>
                        <Text variant="muted" size="xs">
                          {work.allowMultipleFiles
                            ? `Select up to 20 files${uploadLimit ? ` (${formatMb(uploadLimit.uploadLimitBytes)} each)` : ""}.`
                            : `Select one file${uploadLimit ? ` (up to ${formatMb(uploadLimit.uploadLimitBytes)})` : ""}.`}{" "}
                          Attaching files does not hand them in.
                        </Text>
                      </>
                    )}
                  {open &&
                    !work.allowMultipleFiles &&
                    submissionFiles.length > 0 && (
                      <Text variant="muted" size="xs">
                          This assignment allows one file. Hand in when you are
                          ready.
                      </Text>
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

        {!offline && work.status === "published" && work.isClosed && (
          <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
            {pastDueMessage(studentDueAt(work))}.
          </Text>
        )}

        {!offline && work.status === "closed" && !submitted && (
          <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
            This closed before you handed anything in.
          </Text>
        )}
      </View>
      {work.kind === "quiz" && open && quizInProgress && (
        <ConfirmDialog
          open={submitConfirmation}
          title="Ready to submit?"
          message={`You have answered ${answeredCount} of ${work.questions.length} questions. Your quiz will be marked as soon as you submit. ${attemptWarning}${secondsRemaining === null ? "" : ` Time remaining: ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}.`}`}
          confirmLabel="Submit quiz"
          cancelLabel="Keep working"
          loading={working}
          onConfirm={() => {
            void submitQuiz();
          }}
          onCancel={() => setSubmitConfirmation(false)}
        />
      )}
      <LockdownOverlay
        visible={lockdown.showOverlay}
        reason={lockdown.state.reason}
        platform={PINNING_PLATFORM}
        pinBusy={pinBusy}
        pinFailed={pinFailed}
        onPin={() => {
          void pinAgain();
        }}
        onContinueWithoutPinning={() => setPinningWaived(true)}
        timeLeft={
          secondsRemaining !== null
            ? `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`
            : null
        }
        onReturn={lockdown.returnToQuiz}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { flexDirection: "row", alignItems: "center", gap: 12 },
  questionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  questionBadges: {
    alignItems: "flex-end",
    gap: 6,
  },
  timerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  timer: {
    fontFamily: "monospace",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
  },
  progressLabel: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: 4,
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
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
