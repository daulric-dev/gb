"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { uploadFile } from "@/lib/files/upload";
import { formatMb, uploadSizeError, useUploadLimit } from "@/lib/files/upload-limit";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  Loader2,
  Paperclip,
  PenLine,
  Upload,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { RubricGrid } from "@/components/rubric/RubricGrid";
import { cn } from "@/lib/utils";
import {
  dueLabel,
  studentDueAt,
  type PortalWorkDetail,
} from "../../_components/work-types";
import { DueDateNotice } from "../../_components/due-notice";
import { userMessage } from "@/lib/errors";
import { useQuizLockdown } from "@/hooks/use-quiz-lockdown";
import { enterFullscreen, exitFullscreen } from "@/lib/quiz-lockdown";
import { quizMinutesLabel } from "@/lib/courses/accommodations";
import {
  LockdownOverlay,
  LockdownStartCard,
} from "../../_components/quiz-lockdown";

export default function PortalWorkDetailPage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ activityId: string }>();
  const activityId = params?.activityId ?? "";

  const work = useSignal<PortalWorkDetail | null>(null);
  const loading = useSignal(true);
  const working = useSignal(false);
  const submitConfirmation = useSignal(false);
  /** questionId -> chosen optionId */
  const answers = useSignal<Record<string, string>>({});
  /** questionId -> typed answer, for short-answer questions */
  const written = useSignal<Record<string, string>>({});
  const text = useSignal("");
  const uploading = useSignal(false);
  const uploadProgress = useSignal(0);
  // The school's upload limit, for the hint and a check before the ticket.
  const uploadLimit = useUploadLimit();
  const fileInput = useRef<HTMLInputElement>(null);
  const quizSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quizSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const quizSaveRevision = useRef(0);
  const quizSavedRevision = useRef(0);
  const timeoutHandled = useRef<string | null>(null);
  const quizSaveState = useSignal<"saved" | "saving" | "error">("saved");
  const [clock, setClock] = useState(0);
  const serverClockOffset = useSignal(0);

  const load = useCallback(async () => {
    if (!activityId) return null;
    try {
      const data = await api<PortalWorkDetail>(
        `/portal/me/activities/${activityId}`,
      );
      work.value = data;
      text.value = data.submission?.textBody ?? "";
      const saved = data.quizAttempt?.answers ?? [];
      serverClockOffset.value = data.quizAttempt
        ? Date.parse(data.quizAttempt.serverNow) - Date.now()
        : 0;
      answers.value = Object.fromEntries(
        saved.flatMap((answer) =>
          answer.optionId ? [[answer.questionId, answer.optionId]] : [],
        ),
      );
      written.value = Object.fromEntries(
        saved.flatMap((answer) =>
          answer.text !== null ? [[answer.questionId, answer.text]] : [],
        ),
      );
      quizSaveRevision.current = 0;
      quizSavedRevision.current = 0;
      quizSaveState.value = "saved";
      return data;
    } catch {
      work.value = null;
      return null;
    } finally {
      loading.value = false;
    }
  }, [
    activityId,
    work,
    text,
    loading,
    answers,
    written,
    quizSaveState,
    serverClockOffset,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const deadline = work.value?.quizAttempt?.expiresAt ?? null;
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const currentQuizAnswers = useCallback((): {
    questionId: string;
    optionId?: string;
    text?: string;
  }[] => {
    const current = work.value;
    if (!current) return [];
    return current.questions.flatMap<{
      questionId: string;
      optionId?: string;
      text?: string;
    }>((question) => {
      if (question.kind === "short_answer") {
        const answer = written.value[question.id]?.trim();
        return answer ? [{ questionId: question.id, text: answer }] : [];
      }
      const optionId = answers.value[question.id];
      return optionId ? [{ questionId: question.id, optionId }] : [];
    });
  }, [work, written, answers]);

  const persistQuizAnswers = useCallback(
    (revision: number, snapshot: ReturnType<typeof currentQuizAnswers>) => {
      const save = quizSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          await api(`/portal/me/activities/${activityId}/quiz/answers`, {
            method: "POST",
            body: { answers: snapshot },
            keepalive: true,
          });
          quizSavedRevision.current = Math.max(
            quizSavedRevision.current,
            revision,
          );
          if (quizSaveRevision.current === revision) {
            quizSaveState.value = "saved";
          }
        });
      quizSaveQueue.current = save;
      return save;
    },
    [activityId, quizSaveState],
  );

  const scheduleQuizSave = useCallback(() => {
    if (!work.value?.quizAttempt?.startedAt) return;
    const revision = ++quizSaveRevision.current;
    const snapshot = currentQuizAnswers();
    quizSaveState.value = "saving";
    if (quizSaveTimer.current) clearTimeout(quizSaveTimer.current);
    quizSaveTimer.current = setTimeout(() => {
      quizSaveTimer.current = null;
      void persistQuizAnswers(revision, snapshot).catch(() => {
        if (quizSaveRevision.current === revision) {
          quizSaveState.value = "error";
        }
      });
    }, 400);
  }, [work, currentQuizAnswers, persistQuizAnswers, quizSaveState]);

  const flushQuizSave = useCallback(async () => {
    if (quizSaveTimer.current) {
      clearTimeout(quizSaveTimer.current);
      quizSaveTimer.current = null;
    }
    if (quizSaveRevision.current > quizSavedRevision.current) {
      await persistQuizAnswers(
        quizSaveRevision.current,
        currentQuizAnswers(),
      );
    } else {
      await quizSaveQueue.current;
    }
  }, [currentQuizAnswers, persistQuizAnswers]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void flushQuizSave();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushQuizSave();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (quizSaveTimer.current) clearTimeout(quizSaveTimer.current);
      void flushQuizSave();
    };
  }, [flushQuizSave]);

  const secondsRemaining = deadline
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(deadline) - (clock + serverClockOffset.value)) / 1000,
        ),
      )
    : null;

  // Lockdown quizzes: monitored only while an attempt can still be answered.
  const lockdown = useQuizLockdown({
    activityId,
    enabled:
      !!work.value?.lockdownBrowser &&
      work.value.kind === "quiz" &&
      work.value.status === "published" &&
      !!work.value.quizAttempt?.startedAt &&
      secondsRemaining !== 0,
  });

  useEffect(() => {
    if (!deadline || secondsRemaining !== 0 || timeoutHandled.current === deadline) {
      return;
    }
    timeoutHandled.current = deadline;
    submitConfirmation.value = false;
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
  }, [
    activityId,
    deadline,
    secondsRemaining,
    submitConfirmation,
    load,
  ]);

  async function startQuiz() {
    working.value = true;
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
      working.value = false;
    }
  }

  function startLockdownQuiz() {
    // Fullscreen needs this click's user gesture, so ask before any await.
    // Where it is unavailable (iPhone Safari) the quiz starts without it.
    const fullscreen = enterFullscreen();
    void startQuiz().then(async () => {
      await fullscreen;
      if (!work.value?.quizAttempt?.startedAt) exitFullscreen();
    });
  }

  async function submitQuiz() {
    const w = work.value;
    if (!w) return;

    working.value = true;
    try {
      await flushQuizSave();
      const result = await api<{ score: number; points: number }>(
        `/portal/me/activities/${activityId}/quiz`,
        {
          method: "POST",
          body: {
            answers: currentQuizAnswers(),
          },
        },
      );
      toast.success(`Submitted — you scored ${result.score}/${result.points}`);
      // A retake starts blank rather than pre-filled with the last attempt.
      answers.value = {};
      written.value = {};
      submitConfirmation.value = false;
      await load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to submit"));
    } finally {
      working.value = false;
    }
  }

  async function attachFile(file: File) {
    const tooLarge = uploadSizeError(file.size, uploadLimit?.uploadLimitBytes);
    if (tooLarge) {
      toast.error(tooLarge);
      return;
    }
    uploading.value = true;
    uploadProgress.value = 0;
    try {
      await uploadFile(
        file,
        {
          ticket: `/portal/me/activities/${activityId}/upload-ticket`,
          complete: (fileId) =>
            `/portal/me/activities/${activityId}/upload-ticket/${fileId}/complete`,
        },
        { onProgress: (fraction) => (uploadProgress.value = fraction) },
      );
      toast.success("File attached — hand in when you are ready");
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to upload"));
    } finally {
      uploading.value = false;
      uploadProgress.value = 0;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submitAssignment() {
    const attached = !!work.value?.submission?.fileId;
    if (!text.value.trim() && !attached) {
      toast.error("Add your work before handing in");
      return;
    }

    working.value = true;
    try {
      await api(`/portal/me/activities/${activityId}/submit`, {
        method: "POST",
        body: { textBody: text.value.trim() || undefined },
      });
      toast.success("Handed in");
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to hand in"));
    } finally {
      working.value = false;
    }
  }

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!work.value) {
    return (
      <div className="space-y-6">
        <BackTitleToolbar
          title="Work"
          description="This could not be loaded, or is no longer available"
          onBack={() => router.push("/portal/work")}
        />
      </div>
    );
  }

  const w = work.value;
  const backHref = w.courseId
    ? `/portal/courses/${w.courseId}/assignments`
    : "/portal/work";
  const offline = w.kind === "offline";
  const submitted = !!w.submission && w.submission.status !== "draft";
  // A quiz can be sat again while attempts remain; anything else is done once.
  const attemptsLeft =
    w.kind === "quiz" && w.maxAttempts === 0
      ? Infinity
      : Math.max(0, (w.maxAttempts || 1) - (w.attemptsUsed ?? 0));
  const canRetake = w.kind === "quiz" && attemptsLeft > 0;
  // isClosed: past the student's due date, outside a running quiz attempt.
  const open =
    !offline &&
    w.status === "published" &&
    !w.isClosed &&
    (!submitted || canRetake);
  const quizInProgress = !!w.quizAttempt?.startedAt;
  const canStartQuiz = open && !quizInProgress;
  const quizCanAnswer =
    open && quizInProgress && secondsRemaining !== 0;
  const unansweredQuestions = w.questions
    .map((question, index) => ({
      question,
      number: index + 1,
      answered:
        question.kind === "short_answer"
          ? !!written.value[question.id]?.trim()
          : !!answers.value[question.id],
    }))
    .filter((item) => !item.answered);
  const unansweredQuestionIds = new Set(
    unansweredQuestions.map(({ question }) => question.id),
  );
  const answeredCount = w.questions.length - unansweredQuestions.length;
  const attemptWarning =
    w.maxAttempts === 0
      ? "You can retake this quiz as often as you like."
      : (w.attemptsUsed ?? 0) + 1 >= w.maxAttempts
        ? "This uses your last attempt. You will not be able to change your answers after submitting."
        : `This uses one of your ${w.maxAttempts} attempts. Only your latest attempt counts.`;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={w.title}
        description={`${w.points} points · ${dueLabel(studentDueAt(w))}${
          w.hasExtension ? " (extended)" : ""
        }`}
        onBack={() => router.push(backHref)}
      />

      {w.courseId && w.courseName && (
        <Link
          href={`/portal/courses/${w.courseId}`}
          className="-mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <BookOpen className="size-4" />
          {w.courseName}
        </Link>
      )}

      <DueDateNotice work={w} />

      {submitted && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {w.submission?.excused
                  ? "Excused - this doesn't count toward your grade"
                  : w.submission?.status === "graded"
                    ? `Marked: ${w.submission.score}/${w.points}`
                    : "Handed in"}
              </p>
              {w.submission?.feedback && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {w.submission.feedback}
                </p>
              )}
              {w.kind === "quiz" && canRetake && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {attemptsLeft === Infinity
                    ? "You can try this again as often as you like."
                    : `You can try again — ${attemptsLeft} attempt${
                        attemptsLeft === 1 ? "" : "s"
                      } left.`}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {w.instructions && (
        <Card>
          <CardContent className="py-2">
            <Markdown>{w.instructions}</Markdown>
          </CardContent>
        </Card>
      )}

      {w.rubric && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {w.rubricAssessment ? "How this was marked" : "Rubric"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RubricGrid rubric={w.rubric} assessments={w.rubricAssessment} />
          </CardContent>
        </Card>
      )}

      {offline ? (
        !submitted && (
          <Card className="border-dashed">
            <CardContent className="flex items-start gap-3 py-4">
              <PenLine className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Handed in on paper</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Your teacher records the mark here.
                </p>
              </div>
            </CardContent>
          </Card>
        )
      ) : w.kind === "quiz" ? (
        <div className="space-y-3" {...lockdown.guardProps}>
          {canStartQuiz && w.lockdownBrowser && (
            <LockdownStartCard
              details={`${
                w.timeLimitMinutes
                  ? `You have ${quizMinutesLabel(w.timeLimitMinutes, w.standardTimeLimitMinutes)}, and the timer keeps running if you leave.`
                  : "Your answers are saved as you work."
              }${
                w.maxAttempts === 0
                  ? " Retakes are unlimited."
                  : ` ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} available.`
              }`}
              startLabel={submitted ? "Start another attempt" : "Start quiz"}
              busy={working.value}
              onStartAction={startLockdownQuiz}
            />
          )}
          {canStartQuiz && !w.lockdownBrowser && (
            <Card>
              <CardContent className="space-y-3 py-4">
                <p className="text-sm font-medium">
                  {submitted ? "Ready for another attempt?" : "Ready to begin?"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {w.timeLimitMinutes
                    ? `You have ${quizMinutesLabel(w.timeLimitMinutes, w.standardTimeLimitMinutes)}. The timer starts when you begin and continues if you leave the quiz.`
                    : "Your answers are saved as you work. You can leave and return to this attempt."}
                  {w.maxAttempts === 0
                    ? " Retakes are unlimited."
                    : ` ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} available.`}
                </p>
                <Button onClick={startQuiz} disabled={working.value}>
                  {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {submitted ? "Start another attempt" : "Start quiz"}
                </Button>
              </CardContent>
            </Card>
          )}
          {quizInProgress && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-4">
              <div>
                <p className="text-sm font-medium">
                  {secondsRemaining === null
                    ? "Your progress is saved automatically"
                    : "Time remaining"}
                </p>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {quizSaveState.value === "saving"
                    ? "Saving answers…"
                    : quizSaveState.value === "error"
                      ? "Could not save your latest answers."
                      : "All changes saved"}
                </p>
              </div>
              {secondsRemaining !== null && (
                <p
                  className="font-mono text-lg font-semibold tabular-nums"
                  aria-label="Time remaining"
                  aria-live={secondsRemaining <= 60 ? "assertive" : "off"}
                >
                  {Math.floor(secondsRemaining / 60)}:
                  {String(secondsRemaining % 60).padStart(2, "0")}
                </p>
              )}
              {quizSaveState.value === "error" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => scheduleQuizSave()}
                >
                  Retry save
                </Button>
              )}
            </div>
          )}
          {quizInProgress && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Your progress</span>
                <span className="text-muted-foreground" aria-live="polite">
                  {answeredCount} of {w.questions.length} answered
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Quiz answer progress"
                aria-valuemin={0}
                aria-valuemax={w.questions.length}
                aria-valuenow={answeredCount}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${
                      w.questions.length
                        ? (answeredCount / w.questions.length) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              {unansweredQuestions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Still to answer:{" "}
                  {unansweredQuestions.map(({ number }, index) => (
                    <span key={number}>
                      {index > 0 ? ", " : ""}
                      <button
                        type="button"
                        className="font-medium text-primary underline underline-offset-2"
                        onClick={() =>
                          document
                            .getElementById(`quiz-question-${number}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            })
                        }
                      >
                        {number}
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
          {(quizInProgress || !open) && w.questions.map((q, i) => (
            <Card key={q.id} id={`quiz-question-${i + 1}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">
                    {i + 1}. {q.prompt}
                  </CardTitle>
                  <div className="flex shrink-0 items-center gap-2">
                    {quizCanAnswer && unansweredQuestionIds.has(q.id) && (
                      <Badge variant="outline">Not answered</Badge>
                    )}
                    <Badge variant="secondary">{q.points} pt</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {q.kind === "short_answer" ? (
                  <Input
                    placeholder="Type your answer"
                    value={written.value[q.id] ?? ""}
                    disabled={!quizCanAnswer}
                    onChange={(e) => {
                      written.value = {
                        ...written.value,
                        [q.id]: e.target.value,
                      };
                      scheduleQuizSave();
                    }}
                  />
                ) : (
                  q.options.map((o) => {
                    const chosen = answers.value[q.id] === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!quizCanAnswer}
                        aria-pressed={chosen}
                        onClick={() => {
                          answers.value = {
                            ...answers.value,
                            [q.id]: o.id,
                          };
                          scheduleQuizSave();
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          chosen
                            ? "border-primary bg-primary/5 font-medium"
                            : "hover:bg-muted",
                          !open && "opacity-70",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border",
                            chosen && "border-primary bg-primary",
                          )}
                        />
                        {o.label}
                      </button>
                        );
                    })
                )}
              </CardContent>
            </Card>
          ))}

          {open && quizInProgress && (
            <Button
              className="w-full"
              onClick={() => {
                if (unansweredQuestions.length > 0) {
                  toast.error(
                    `Answer all questions before submitting (${unansweredQuestions.length} left).`,
                  );
                  document
                    .getElementById(
                      `quiz-question-${unansweredQuestions[0].number}`,
                    )
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                if (quizSaveState.value === "error") {
                  toast.error("Save your latest answers before submitting.");
                  return;
                }
                submitConfirmation.value = true;
              }}
              disabled={working.value || secondsRemaining === 0}
            >
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {submitted ? "Try again" : "Submit quiz"}
            </Button>
          )}
          {open && quizInProgress && (
            <p className="text-center text-xs text-muted-foreground">
              {w.maxAttempts === 0
                ? "Marked as soon as you submit, and you can retake it."
                : w.maxAttempts === 1
                  ? "You get one attempt, and it is marked as soon as you submit."
                  : `You get ${w.maxAttempts} attempts, and only the latest counts.`}
            </p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {w.allowText ? (
              <Textarea
                rows={10}
                placeholder="Type your answer here"
                value={text.value}
                disabled={!open}
                onChange={(e) => (text.value = e.target.value)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This assignment is handed in as a file.
              </p>
            )}

            {w.allowFile && (
              <div className="space-y-2">
                {w.submission?.fileId && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {w.submission.fileName ?? "Attached file"}
                    </span>
                  </div>
                )}

                {open && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) attachFile(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading.value}
                      onClick={() => fileInput.current?.click()}
                    >
                      {uploading.value ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 size-4" />
                      )}
                      {uploading.value
                        ? `Uploading ${Math.round(uploadProgress.value * 100)}%`
                        : w.submission?.fileId
                          ? "Replace file"
                          : "Attach a file"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {uploadLimit
                        ? `Up to ${formatMb(uploadLimit.uploadLimitBytes)}, and`
                        : "An"}{" "}
                      interrupted upload picks up where it stopped. Attaching a
                      file does not hand it in.
                    </p>
                  </>
                )}
              </div>
            )}

            {open && (
              <Button onClick={submitAssignment} disabled={working.value}>
                {working.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Hand in
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!offline && w.status === "closed" && !submitted && (
        <p className="text-center text-sm text-muted-foreground">
          This closed before you handed anything in.
        </p>
      )}

      {w.kind === "quiz" && open && (
        <AlertDialog
          open={submitConfirmation.value}
          onOpenChange={(value) => (submitConfirmation.value = value)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ready to submit?</AlertDialogTitle>
              <AlertDialogDescription>
                You have answered {answeredCount} of {w.questions.length}{" "}
                questions. Your quiz will be marked as soon as you submit.
                {" "}
                {attemptWarning}
                {secondsRemaining !== null &&
                  ` Time remaining: ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={working.value}>
                Keep working
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={working.value}
                onClick={submitQuiz}
              >
                {working.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Submit quiz
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {lockdown.showOverlay && (
        <LockdownOverlay
          state={lockdown.state}
          timeLeft={
            secondsRemaining !== null
              ? `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`
              : null
          }
          onReturnAction={lockdown.returnToQuiz}
        />
      )}
    </div>
  );
}
