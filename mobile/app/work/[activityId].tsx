import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Paperclip,
  Upload,
} from "lucide-react-native";
import { api, isNetworkError } from "@/lib/api";
import { isOffline } from "@/lib/connectivity";
import { draftQueue, offlineScopeKey } from "@/lib/offline-store";
import {
  runDraftSync,
  serverStateOf,
  workForStorage,
  workPath,
} from "@/lib/offline-sync";
import {
  answersVersion,
  closesAtFor,
  textVersion,
  type AnswerLike,
} from "@/lib/sync-queue";
import { quizDraftText, textDraftText } from "@/lib/offline-draft-text";
import {
  useConnectivity,
  useDraft,
  useOfflineReads,
} from "@/features/offline/OfflineReads";
import { OfflineDraftNotice } from "@/features/offline/OfflineDraftNotice";
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
import { uploadQuizQuestionFile, uploadSubmissionFile } from "@/lib/upload";
import { formatMb, uploadSizeError, useUploadLimit } from "@/lib/upload-limit";
import { formatScore } from "@/lib/format-number";
import { Markdown } from "@/components/ui/Markdown";
import { RubricView } from "@/features/course/RubricView";
import { PeerReviewSection } from "@/features/work/PeerReviewSection";
import { userMessage } from "@/lib/errors";
import { useQuizLockdown } from "@/lib/use-quiz-lockdown";
import { PINNING_PLATFORM, useAppPinning } from "@/lib/use-app-pinning";
import { quizMinutesLabel } from "@/lib/accommodations";
import {
  LockdownOverlay,
  LockdownStartCard,
  UnpinCard,
} from "@/features/work/QuizLockdown";

/** The quiz screen's own answer state, kept with an offline draft to restore it. */
interface QuizDraftState {
  answers: Record<string, string>;
  written: Record<string, string>;
  multi: Record<string, string[]>;
  numeric: Record<string, string>;
  matching: Record<string, Record<string, string>>;
  ordering: Record<string, string[]>;
  file: Record<string, { fileId: string; fileName?: string }>;
}

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
  /** questionId -> typed answer, for short-answer and essay questions */
  const [written, setWritten] = useState<Record<string, string>>({});
  /** questionId -> selected optionIds, for multiple-select */
  const [multiAnswers, setMultiAnswers] = useState<Record<string, string[]>>({});
  /** questionId -> entered numeric answer */
  const [numericAnswers, setNumericAnswers] = useState<Record<string, string>>({});
  /** questionId -> (optionId -> matched choice) */
  const [matchingAnswers, setMatchingAnswers] = useState<Record<string, Record<string, string>>>({});
  /** questionId -> optionIds in order */
  const [orderingAnswers, setOrderingAnswers] = useState<Record<string, string[]>>({});
  /** questionId -> { fileId, fileName } */
  const [fileAnswers, setFileAnswers] = useState<Record<string, { fileId: string; fileName?: string }>>({});
  const [questionUploading, setQuestionUploading] = useState<Record<string, boolean>>({});
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
  // Offline mode: saved copies, the network state and this work's drafts.
  const { get, savedAt } = useOfflineReads();
  const network = useConnectivity();
  const offlineNow = network === "offline";
  const quizDraft = useDraft(activityId, "quiz_answers");
  const textDraft = useDraft(activityId, "assignment_text");
  /** The server version the next offline draft starts from. */
  const baseVersion = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!activityId) return;
    const data = await get<PortalWorkDetail>(
      workPath(activityId),
      workForStorage,
    ).catch(() => null);
    setWork(data);
    const scopeKey = offlineScopeKey();
    // An assignment's text drafted on this device comes back, unless the
    // server copy moved on meanwhile: then both are kept and the student
    // chooses (OfflineDraftNotice).
    const localText =
      scopeKey && data?.kind === "assignment"
        ? draftQueue.get(scopeKey, activityId, "assignment_text")
        : null;
    const serverText = data?.submission?.textBody ?? "";
    if (localText && data) {
      const draftText = (localText.draft as { text?: string })?.text ?? "";
      if (
        localText.baseVersion !== textVersion(data.submission) &&
        draftText !== serverText
      ) {
        draftQueue.flag(scopeKey!, activityId, "assignment_text", "conflict");
      }
      setText(draftText);
    } else {
      setText(serverText);
    }
    setServerClockOffset(
      data?.quizAttempt
        ? Date.parse(data.quizAttempt.serverNow) - Date.now()
        : 0,
    );
    const saved = data?.quizAttempt?.answers ?? [];
    setAnswers(
      Object.fromEntries(
        saved.flatMap((answer) =>
          answer.optionId ? [[answer.questionId, answer.optionId]] : [],
        ),
      ),
    );
    setWritten(
      Object.fromEntries(
        saved.flatMap((answer) =>
          typeof answer.text === "string" ? [[answer.questionId, answer.text]] : [],
        ),
      ),
    );
    setMultiAnswers(
      Object.fromEntries(
        saved.flatMap((answer) =>
          answer.optionIds ? [[answer.questionId, answer.optionIds]] : [],
        ),
      ),
    );
    setNumericAnswers(
      Object.fromEntries(
        saved.flatMap((answer) =>
          answer.numeric !== null && answer.numeric !== undefined
            ? [[answer.questionId, String(answer.numeric)]]
            : [],
        ),
      ),
    );
    setMatchingAnswers(
      Object.fromEntries(
        saved.flatMap((answer) => {
          if (!answer.matches) return [];
          if (Array.isArray(answer.matches)) {
            return [
              [
                answer.questionId,
                Object.fromEntries(
                  answer.matches.map((m: any) => [m.optionId, m.label]),
                ),
              ],
            ];
          }
          if (typeof answer.matches === "object") {
            return [[answer.questionId, answer.matches as Record<string, string>]];
          }
          return [];
        }),
      ),
    );
    setOrderingAnswers(
      Object.fromEntries(
        (data?.questions ?? [])
          .filter((q) => q.kind === "ordering")
          .map((q) => {
            const savedAns = saved.find((a) => a.questionId === q.id);
            const order =
              savedAns?.optionIds && savedAns.optionIds.length > 0
                ? savedAns.optionIds
                : q.options.map((o) => o.id);
            return [q.id, order];
          }),
      ),
    );
    setFileAnswers(
      Object.fromEntries(
        saved.flatMap((answer) =>
          answer.fileId ? [[answer.questionId, { fileId: answer.fileId }]] : [],
        ),
      ),
    );
    baseVersion.current = data?.quizAttempt
      ? serverStateOf(data).version
      : null;
    // Answers drafted offline for this attempt are what the student sees.
    const localQuiz =
      scopeKey && data?.quizAttempt
        ? draftQueue.get(scopeKey, activityId, "quiz_answers")
        : null;
    if (
      localQuiz &&
      localQuiz.state !== "synced" &&
      localQuiz.attemptStartedAt === data?.quizAttempt?.startedAt
    ) {
      const d = localQuiz.draft as QuizDraftState;
      setAnswers(d.answers ?? {});
      setWritten(d.written ?? {});
      setMultiAnswers(d.multi ?? {});
      setNumericAnswers(d.numeric ?? {});
      setMatchingAnswers(d.matching ?? {});
      if (d.ordering) setOrderingAnswers((prev) => ({ ...prev, ...d.ordering }));
      setFileAnswers(d.file ?? {});
    }
    quizSaveRevision.current = 0;
    quizSavedRevision.current = 0;
    setQuizSaveState("saved");
  }, [activityId, get]);

  // The queue sent this quiz's draft: later drafts start from what it sent.
  useEffect(() => {
    if (quizDraft?.state === "synced" && quizDraft.syncedVersion) {
      baseVersion.current = quizDraft.syncedVersion;
    }
  }, [quizDraft?.state, quizDraft?.syncedVersion]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  // An assignment's text is kept on this device as it is typed (there is no
  // draft endpoint, only the hand-in), so it survives going offline or
  // closing the app. Text matching the server copy needs no draft.
  useEffect(() => {
    if (
      !work ||
      work.kind !== "assignment" ||
      !work.allowText ||
      work.status !== "published" ||
      work.isClosed ||
      (work.submission && work.submission.status !== "draft")
    ) {
      return;
    }
    const scopeKey = offlineScopeKey();
    if (!scopeKey) return;
    const timer = setTimeout(() => {
      const current = draftQueue.get(scopeKey, work.id, "assignment_text");
      const draftText = (current?.draft as { text?: string } | undefined)?.text;
      if (text === (work.submission?.textBody ?? "")) {
        if (current && current.state !== "needs_attention") {
          draftQueue.remove(scopeKey, work.id, "assignment_text");
        }
        return;
      }
      if (draftText === text) return;
      draftQueue.enqueue({
        scope: scopeKey,
        activityId: work.id,
        kind: "assignment_text",
        payload: text,
        draft: { text },
        baseVersion: textVersion(work.submission),
        closesAt: closesAtFor(work),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [text, work]);

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
    currentMulti = multiAnswers,
    currentNumeric = numericAnswers,
    currentMatching = matchingAnswers,
    currentOrdering = orderingAnswers,
    currentFile = fileAnswers,
  ) {
    if (!work) return [];
    return work.questions.reduce<
      {
        questionId: string;
        optionId?: string;
        optionIds?: string[];
        matches?: { optionId: string; label: string }[];
        text?: string;
        numeric?: number;
        fileId?: string;
      }[]
    >((collected, question) => {
      switch (question.kind) {
        case "short_answer":
        case "essay": {
          const answer = currentWritten[question.id]?.trim();
          if (answer) collected.push({ questionId: question.id, text: answer });
          return collected;
        }
        case "multiple_choice":
        case "true_false": {
          const optionId = currentAnswers[question.id];
          if (optionId) collected.push({ questionId: question.id, optionId });
          return collected;
        }
        case "multiple_select": {
          const selected = currentMulti[question.id];
          if (selected && selected.length > 0) {
            collected.push({ questionId: question.id, optionIds: selected });
          }
          return collected;
        }
        case "numeric": {
          const raw = currentNumeric[question.id]?.trim();
          if (raw) {
            const num = Number(raw);
            if (Number.isFinite(num)) {
              collected.push({ questionId: question.id, numeric: num });
            }
          }
          return collected;
        }
        case "matching": {
          const m = currentMatching[question.id];
          if (m) {
            const matches = Object.entries(m)
              .filter(([_, label]) => !!label?.trim())
              .map(([optionId, label]) => ({ optionId, label: label.trim() }));
            if (matches.length > 0) {
              collected.push({ questionId: question.id, matches });
            }
          }
          return collected;
        }
        case "ordering": {
          const order = currentOrdering[question.id];
          if (order && order.length > 0) {
            collected.push({ questionId: question.id, optionIds: order });
          }
          return collected;
        }
        case "file_upload": {
          const f = currentFile[question.id];
          if (f?.fileId) {
            collected.push({ questionId: question.id, fileId: f.fileId });
          }
          return collected;
        }
        default:
          return collected;
      }
    }, []);
  }

  function draftState(
    a = answers,
    w = written,
    m = multiAnswers,
    n = numericAnswers,
    mt = matchingAnswers,
    o = orderingAnswers,
    f = fileAnswers,
  ): QuizDraftState {
    return { answers: a, written: w, multi: m, numeric: n, matching: mt, ordering: o, file: f };
  }

  /**
   * Keep the answers on this device for the sync queue. Not for Lockdown
   * quizzes: an offline attempt can't report that the student is still in
   * the quiz, so they need a connection to keep answering.
   */
  function queueQuizDraft(
    snapshot: ReturnType<typeof quizAnswers>,
    state: QuizDraftState,
  ): boolean {
    const scopeKey = offlineScopeKey();
    if (!scopeKey || !work?.quizAttempt || lockdownQuiz) return false;
    // A draft left from an earlier attempt that needs the student is not
    // overwritten; it is shown above until they view, copy or delete it.
    const earlier = draftQueue.get(scopeKey, activityId, "quiz_answers");
    if (
      earlier &&
      earlier.state === "needs_attention" &&
      earlier.attemptStartedAt !== work.quizAttempt.startedAt
    ) {
      return false;
    }
    draftQueue.enqueue({
      scope: scopeKey,
      activityId,
      kind: "quiz_answers",
      payload: { answers: snapshot },
      draft: state,
      baseVersion: baseVersion.current,
      attemptStartedAt: work.quizAttempt.startedAt,
      quizExpiresAt: work.quizAttempt.expiresAt,
      closesAt: closesAtFor(work),
    });
    return true;
  }

  function persistQuizAnswers(
    revision: number,
    snapshot: ReturnType<typeof quizAnswers>,
    state: QuizDraftState = draftState(),
  ) {
    const save = quizSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const scopeKey = offlineScopeKey();
        const pending = scopeKey
          ? draftQueue.get(scopeKey, activityId, "quiz_answers")
          : null;
        // Offline, or a draft is still waiting: queue behind it, in order.
        const queueIt =
          isOffline() ||
          (!!pending &&
            pending.state !== "synced" &&
            pending.attemptStartedAt === (work?.quizAttempt?.startedAt ?? null));
        if (!(queueIt && queueQuizDraft(snapshot, state))) {
          try {
            await api(`/portal/me/activities/${activityId}/quiz/answers`, {
              method: "POST",
              body: { answers: snapshot },
            });
            baseVersion.current = answersVersion(
              work?.quizAttempt?.startedAt ?? null,
              snapshot as AnswerLike[],
            );
          } catch (err) {
            if (!isNetworkError(err) || !queueQuizDraft(snapshot, state)) {
              throw err;
            }
          }
        }
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
    nextMulti = multiAnswers,
    nextNumeric = numericAnswers,
    nextMatching = matchingAnswers,
    nextOrdering = orderingAnswers,
    nextFile = fileAnswers,
  ) {
    if (!work?.quizAttempt?.startedAt) return;
    const revision = ++quizSaveRevision.current;
    const snapshot = quizAnswers(
      nextAnswers,
      nextWritten,
      nextMulti,
      nextNumeric,
      nextMatching,
      nextOrdering,
      nextFile,
    );
    setQuizSaveState("saving");
    if (quizSaveTimer.current) clearTimeout(quizSaveTimer.current);
    quizSaveTimer.current = setTimeout(() => {
      quizSaveTimer.current = null;
      void persistQuizAnswers(
        revision,
        snapshot,
        draftState(
          nextAnswers,
          nextWritten,
          nextMulti,
          nextNumeric,
          nextMatching,
          nextOrdering,
          nextFile,
        ),
      ).catch(() => {
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
          isNetworkError(err)
            ? "Time is up. The server submits the answers it received; answers saved only on this device stay here."
            : userMessage(err, "Time is up; the server will submit your saved answers."),
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
    // A final hand-in is never queued: it uses up an attempt and can't be
    // repeated safely, so it needs a connection.
    if (isOffline()) {
      setSubmitConfirmation(false);
      toast.error(
        "Submitting needs a connection. Your answers are saved on this device.",
      );
      return;
    }

    setWorking(true);
    try {
      await flushQuizSave();
      const scopeKey = offlineScopeKey();
      if (scopeKey && draftQueue.get(scopeKey, activityId, "quiz_answers")) {
        await runDraftSync();
        const left = draftQueue.get(scopeKey, activityId, "quiz_answers");
        if (left && left.state !== "synced") {
          setSubmitConfirmation(false);
          toast.error(
            left.state === "needs_attention"
              ? "Your offline answers need attention before you submit."
              : "Your offline answers have not synced yet. Try again in a moment.",
          );
          return;
        }
      }
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
      setMultiAnswers({});
      setNumericAnswers({});
      setMatchingAnswers({});
      setOrderingAnswers({});
      setFileAnswers({});
      setSubmitConfirmation(false);
      if (scopeKey) draftQueue.remove(scopeKey, activityId, "quiz_answers");
      await load();
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? "Submitting needs a connection. Your answers are saved on this device."
          : userMessage(err, "Failed to submit"),
      );
    } finally {
      setWorking(false);
    }
  }

  async function attachQuestionFile(questionId: string) {
    const q = work?.questions.find((item) => item.id === questionId);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: q?.fileTypes?.length ? q.fileTypes : ["*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const asset = res.assets[0];
      if (q?.fileMaxMb && asset.size && asset.size > q.fileMaxMb * 1024 * 1024) {
        toast.error(`File is too large (maximum ${q.fileMaxMb} MB)`);
        return;
      }
      setQuestionUploading((prev) => ({ ...prev, [questionId]: true }));
      const uploaded = await uploadQuizQuestionFile(activityId, questionId, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
      });
      const nextFile = {
        ...fileAnswers,
        [questionId]: { fileId: uploaded.fileId, fileName: asset.name },
      };
      setFileAnswers(nextFile);
      scheduleQuizSave(
        answers,
        written,
        multiAnswers,
        numericAnswers,
        matchingAnswers,
        orderingAnswers,
        nextFile,
      );
      toast.success("File attached to question");
    } catch (err) {
      toast.error(userMessage(err, "Failed to upload file"));
    } finally {
      setQuestionUploading((prev) => ({ ...prev, [questionId]: false }));
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

    if (isOffline()) {
      toast.error(
        "Handing in needs a connection. Your text is saved on this device.",
      );
      return;
    }

    setWorking(true);
    try {
      await api(`/portal/me/activities/${activityId}/submit`, {
        method: "POST",
        body: { textBody: text.trim() || undefined },
      });
      const scopeKey = offlineScopeKey();
      if (scopeKey) draftQueue.remove(scopeKey, activityId, "assignment_text");
      toast.success("Handed in");
      await load();
    } catch (err) {
      toast.error(
        isNetworkError(err)
          ? "Can't reach the server. Your text is saved on this device; hand in when you're back online."
          : userMessage(err, "Failed to hand in"),
      );
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
        description={
          offlineNow
            ? "You're offline and this hasn't been saved on this device yet. Open it once while online to read it offline."
            : "This could not be loaded"
        }
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
  // Lockdown quizzes can't be answered offline: presence can't be reported.
  const lockdownOffline = lockdownQuiz && offlineNow;
  const quizCanAnswer =
    open && quizInProgress && secondsRemaining !== 0 && !lockdownOffline;
  const scopeKey = offlineScopeKey();
  const keepDeviceDraft = (kind: "quiz_answers" | "assignment_text") => {
    if (!scopeKey) return;
    draftQueue.keepDeviceCopy(
      scopeKey,
      work.id,
      kind,
      kind === "quiz_answers"
        ? serverStateOf(work).version
        : textVersion(work.submission),
    );
    if (kind === "quiz_answers") void runDraftSync();
  };
  const dropDraft = (kind: "quiz_answers" | "assignment_text") => {
    if (!scopeKey) return;
    draftQueue.remove(scopeKey, work.id, kind);
    if (kind === "assignment_text") setText(work.submission?.textBody ?? "");
    else void load();
  };
  const quizDraftAnswers =
    ((quizDraft?.payload as { answers?: AnswerLike[] } | undefined)?.answers ??
      []);
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
  const isQuestionAnswered = (question: (typeof work.questions)[0]) => {
    switch (question.kind) {
      case "short_answer":
      case "essay":
        return !!written[question.id]?.trim();
      case "multiple_choice":
      case "true_false":
        return !!answers[question.id];
      case "multiple_select":
        return (multiAnswers[question.id]?.length ?? 0) > 0;
      case "numeric": {
        const val = numericAnswers[question.id]?.trim();
        return !!val && Number.isFinite(Number(val));
      }
      case "matching": {
        const m = matchingAnswers[question.id];
        return !!m && question.options.every((o) => !!m[o.id]);
      }
      case "ordering":
        return (orderingAnswers[question.id]?.length ?? 0) === question.options.length;
      case "file_upload":
        return !!fileAnswers[question.id]?.fileId;
      default:
        return false;
    }
  };

  const unansweredQuestions = work.questions
    .map((question, index) => ({
      question,
      number: index + 1,
      answered: isQuestionAnswered(question),
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
      offlineSavedAt={savedAt}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={{ gap: 12 }}>
        {work.kind === "quiz" && quizDraft && (
          <OfflineDraftNotice
            draft={quizDraft}
            kind="quiz"
            draftText={quizDraftText(work.title, work.questions, quizDraftAnswers)}
            serverText={
              work.quizAttempt
                ? quizDraftText(
                    work.title,
                    work.questions,
                    work.quizAttempt.answers as AnswerLike[],
                  )
                : null
            }
            onKeepDevice={() => keepDeviceDraft("quiz_answers")}
            onUseServer={() => dropDraft("quiz_answers")}
            onDiscard={() => dropDraft("quiz_answers")}
          />
        )}
        {work.kind === "assignment" && textDraft && (
          <OfflineDraftNotice
            draft={textDraft}
            kind="assignment"
            draftText={textDraftText(
              work.title,
              (textDraft.draft as { text?: string } | undefined)?.text ?? "",
            )}
            serverText={
              work.submission?.textBody
                ? textDraftText(work.title, work.submission.textBody)
                : null
            }
            onKeepDevice={() => keepDeviceDraft("assignment_text")}
            onUseServer={() => dropDraft("assignment_text")}
            onDiscard={() => dropDraft("assignment_text")}
          />
        )}
        {!submitted && work.isLate && work.lateUntil && (
          <Card>
            <CardContent style={{ paddingVertical: 12, gap: 4 }}>
              <Text size="sm" weight="500">
                Late submission
              </Text>
              <Text size="xs" variant="muted">
                Past due. Work is accepted until {dueLabel(work.lateUntil)}
                {work.latePenaltyMode && work.latePenaltyMode !== "none" ? " (late penalty applies)" : ""}.
              </Text>
            </CardContent>
          </Card>
        )}
        {submitted && (
          <Card>
            <CardContent style={styles.result}>
              <CheckCircle2 color={colors.primary} size={20} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="500">
                  {work.submission?.excused
                    ? "Excused"
                    : work.submission?.status === "graded"
                      ? `Marked: ${formatScore(work.submission.score)}/${formatScore(work.points)}${
                          (work.submission.latePenaltyPercent ?? 0) > 0
                            ? work.submission.latePenaltyWaived
                              ? " (late penalty waived)"
                              : ` (${formatScore(work.submission.rawScore ?? work.submission.score)} − ${work.submission.latePenaltyPercent}% late)`
                            : ""
                        }`
                      : work.submission?.needsMarking
                        ? "Handed in · Waiting for teacher to mark"
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

        {work.kind === "assignment" ? <PeerReviewSection activityId={work.id} /> : null}

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
            {canStartQuiz && work.lockdownBrowser && offlineNow && (
              <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                You're offline. Lockdown quizzes need a connection the whole
                time, so start this one when you're back online.
              </Text>
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
                  <Button
                    onPress={startQuiz}
                    loading={working}
                    disabled={offlineNow}
                  >
                    {submitted ? "Start another attempt" : "Start quiz"}
                  </Button>
                  {offlineNow && (
                    <Text variant="muted" size="xs">
                      Starting a quiz needs a connection. Once started, you can
                      keep answering offline and your answers sync later.
                    </Text>
                  )}
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
                    <Text
                      variant="muted"
                      size="xs"
                      accessibilityLiveRegion="polite"
                    >
                      {quizSaveState === "saving"
                        ? "Saving answers..."
                        : quizSaveState === "error"
                          ? lockdownOffline
                            ? "Not saved: you're offline."
                            : "Could not save your latest answers."
                          : quizDraft?.state === "saved_offline"
                            ? "Saved offline on this device. Syncs when you're back online."
                            : quizDraft?.state === "syncing"
                              ? "Syncing answers..."
                              : quizDraft?.state === "needs_attention"
                                ? "Needs attention: see above."
                                : quizDraft?.state === "synced"
                                  ? "Synced. All changes saved"
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
            {quizInProgress && lockdownOffline && (
              <Card>
                <CardContent style={{ gap: 4 }}>
                  <Text weight="500" accessibilityRole="alert">
                    Reconnect to keep answering
                  </Text>
                  <Text variant="muted" size="sm">
                    Lockdown quizzes can't be answered offline: the app can't
                    report to your teacher that you're still in the quiz. Your
                    saved answers are safe on the server, and the timer keeps
                    running.
                  </Text>
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
                <CardContent style={{ gap: 10 }}>
                  {(q.kind === "multiple_choice" || q.kind === "true_false") && (
                    <View style={{ gap: 8 }}>
                      {q.options.map((o) => {
                        const chosen = answers[q.id] === o.id;
                        return (
                          <Pressable
                            key={o.id}
                            disabled={!quizCanAnswer}
                            onPress={() => {
                              const nextAnswers = { ...answers, [q.id]: o.id };
                              setAnswers(nextAnswers);
                              scheduleQuizSave(
                                nextAnswers,
                                written,
                                multiAnswers,
                                numericAnswers,
                                matchingAnswers,
                                orderingAnswers,
                                fileAnswers,
                              );
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
                      })}
                    </View>
                  )}

                  {q.kind === "multiple_select" && (
                    <View style={{ gap: 8 }}>
                      {q.options.map((o) => {
                        const selected = (multiAnswers[q.id] ?? []).includes(o.id);
                        return (
                          <Pressable
                            key={o.id}
                            disabled={!quizCanAnswer}
                            onPress={() => {
                              const current = multiAnswers[q.id] ?? [];
                              const next = selected
                                ? current.filter((id) => id !== o.id)
                                : [...current, o.id];
                              const nextMulti = { ...multiAnswers, [q.id]: next };
                              setMultiAnswers(nextMulti);
                              scheduleQuizSave(
                                answers,
                                written,
                                nextMulti,
                                numericAnswers,
                                matchingAnswers,
                                orderingAnswers,
                                fileAnswers,
                              );
                            }}
                            style={({ pressed }) => [
                              styles.option,
                              {
                                borderColor: selected ? colors.primary : colors.border,
                                backgroundColor: selected
                                  ? colors.muted
                                  : "transparent",
                                opacity: pressed || !open ? 0.7 : 1,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.checkbox,
                                {
                                  borderColor: selected
                                    ? colors.primary
                                    : colors.border,
                                  backgroundColor: selected
                                    ? colors.primary
                                    : "transparent",
                                },
                              ]}
                            >
                              {selected && (
                                <Check
                                  size={12}
                                  color={colors.primaryForeground ?? "#fff"}
                                />
                              )}
                            </View>
                            <Text size="sm" weight={selected ? "500" : "400"}>
                              {o.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {q.kind === "short_answer" && (
                    <Input
                      placeholder="Type your answer"
                      value={written[q.id] ?? ""}
                      editable={quizCanAnswer}
                      contextMenuHidden={lockdown.state.active}
                      onChangeText={(value) => {
                        const nextWritten = { ...written, [q.id]: value };
                        setWritten(nextWritten);
                        scheduleQuizSave(
                          answers,
                          nextWritten,
                          multiAnswers,
                          numericAnswers,
                          matchingAnswers,
                          orderingAnswers,
                          fileAnswers,
                        );
                      }}
                    />
                  )}

                  {q.kind === "essay" && (
                    <View style={{ gap: 4 }}>
                      <TextArea
                        placeholder="Type your essay response..."
                        value={written[q.id] ?? ""}
                        editable={quizCanAnswer}
                        contextMenuHidden={lockdown.state.active}
                        numberOfLines={6}
                        maxLength={50000}
                        onChangeText={(value) => {
                          const nextWritten = { ...written, [q.id]: value };
                          setWritten(nextWritten);
                          scheduleQuizSave(
                            answers,
                            nextWritten,
                            multiAnswers,
                            numericAnswers,
                            matchingAnswers,
                            orderingAnswers,
                            fileAnswers,
                          );
                        }}
                      />
                      <Text
                        variant="muted"
                        size="xs"
                        style={{ textAlign: "right" }}
                      >
                        {(written[q.id] ?? "").length} / 50,000 characters
                      </Text>
                    </View>
                  )}

                  {q.kind === "numeric" && (
                    <Input
                      placeholder="Enter a numeric answer"
                      keyboardType="numeric"
                      value={numericAnswers[q.id] ?? ""}
                      editable={quizCanAnswer}
                      contextMenuHidden={lockdown.state.active}
                      onChangeText={(value) => {
                        const nextNumeric = { ...numericAnswers, [q.id]: value };
                        setNumericAnswers(nextNumeric);
                        scheduleQuizSave(
                          answers,
                          written,
                          multiAnswers,
                          nextNumeric,
                          matchingAnswers,
                          orderingAnswers,
                          fileAnswers,
                        );
                      }}
                    />
                  )}

                  {q.kind === "matching" && (
                    <View style={{ gap: 8 }}>
                      {q.options.map((o) => {
                        const choices = ["None", ...(q.matchChoices ?? [])];
                        const currentMatch =
                          matchingAnswers[q.id]?.[o.id] || "None";
                        return (
                          <View
                            key={o.id}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: 8,
                              borderWidth: StyleSheet.hairlineWidth,
                              borderColor: colors.border,
                              borderRadius: 8,
                              gap: 8,
                            }}
                          >
                            <Text
                              size="sm"
                              weight="500"
                              style={{ flex: 1 }}
                            >
                              {o.label}
                            </Text>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!quizCanAnswer}
                              accessibilityLabel={`Match for ${o.label}: ${currentMatch}. Tap for the next choice`}
                              onPress={() => {
                                const idx = choices.indexOf(currentMatch);
                                const nextIdx = (idx + 1) % choices.length;
                                const nextVal =
                                  choices[nextIdx] === "None"
                                    ? ""
                                    : choices[nextIdx];
                                const nextMatching = {
                                  ...matchingAnswers,
                                  [q.id]: {
                                    ...(matchingAnswers[q.id] ?? {}),
                                    [o.id]: nextVal,
                                  },
                                };
                                setMatchingAnswers(nextMatching);
                                scheduleQuizSave(
                                  answers,
                                  written,
                                  multiAnswers,
                                  numericAnswers,
                                  nextMatching,
                                  orderingAnswers,
                                  fileAnswers,
                                );
                              }}
                            >
                              {currentMatch}
                            </Button>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {q.kind === "ordering" && (() => {
                    const order =
                      orderingAnswers[q.id] ?? q.options.map((o) => o.id);
                    const optionsById = new Map(q.options.map((o) => [o.id, o]));
                    return (
                      <View style={{ gap: 6 }}>
                        <Text variant="muted" size="xs">
                          Arrange items in the correct order:
                        </Text>
                        {order.map((optId, idx) => {
                          const opt = optionsById.get(optId);
                          if (!opt) return null;
                          return (
                            <View
                              key={optId}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: 8,
                                borderWidth: StyleSheet.hairlineWidth,
                                borderColor: colors.border,
                                borderRadius: 8,
                                backgroundColor: colors.card,
                              }}
                            >
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 8,
                                  flex: 1,
                                }}
                              >
                                <Badge variant="outline">{String(idx + 1)}</Badge>
                                <Text size="sm" style={{ flex: 1 }}>
                                  {opt.label}
                                </Text>
                              </View>
                              {quizCanAnswer && (
                                <View style={{ flexDirection: "row", gap: 4 }}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={idx === 0}
                                    accessibilityLabel={`Move ${opt.label} up, now ${idx + 1} of ${order.length}`}
                                    onPress={() => {
                                      const next = [...order];
                                      [next[idx - 1], next[idx]] = [
                                        next[idx],
                                        next[idx - 1],
                                      ];
                                      const nextOrdering = {
                                        ...orderingAnswers,
                                        [q.id]: next,
                                      };
                                      setOrderingAnswers(nextOrdering);
                                      scheduleQuizSave(
                                        answers,
                                        written,
                                        multiAnswers,
                                        numericAnswers,
                                        matchingAnswers,
                                        nextOrdering,
                                        fileAnswers,
                                      );
                                    }}
                                  >
                                    <ArrowUp
                                      size={16}
                                      color={colors.foreground}
                                    />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={idx === order.length - 1}
                                    accessibilityLabel={`Move ${opt.label} down, now ${idx + 1} of ${order.length}`}
                                    onPress={() => {
                                      const next = [...order];
                                      [next[idx + 1], next[idx]] = [
                                        next[idx],
                                        next[idx + 1],
                                      ];
                                      const nextOrdering = {
                                        ...orderingAnswers,
                                        [q.id]: next,
                                      };
                                      setOrderingAnswers(nextOrdering);
                                      scheduleQuizSave(
                                        answers,
                                        written,
                                        multiAnswers,
                                        numericAnswers,
                                        matchingAnswers,
                                        nextOrdering,
                                        fileAnswers,
                                      );
                                    }}
                                  >
                                    <ArrowDown
                                      size={16}
                                      color={colors.foreground}
                                    />
                                  </Button>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}

                  {q.kind === "file_upload" && (
                    <View style={{ gap: 8 }}>
                      {fileAnswers[q.id]?.fileId && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            padding: 8,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: colors.border,
                            borderRadius: 8,
                            backgroundColor: colors.muted,
                          }}
                        >
                          <Paperclip
                            size={16}
                            color={colors.mutedForeground}
                          />
                          <Text size="sm" style={{ flex: 1 }}>
                            {fileAnswers[q.id]?.fileName ?? "Attached file"}
                          </Text>
                        </View>
                      )}
                      {quizCanAnswer && offlineNow && (
                        <Text variant="muted" size="xs">
                          Files can't be attached offline: they upload straight
                          to your school. Attach one when you're back online.
                        </Text>
                      )}
                      {quizCanAnswer && !offlineNow && (
                        <Button
                          variant="outline"
                          loading={questionUploading[q.id]}
                          onPress={() => void attachQuestionFile(q.id)}
                        >
                          {fileAnswers[q.id]?.fileId
                            ? "Replace file"
                            : "Attach file"}
                        </Button>
                      )}
                      <Text variant="muted" size="xs">
                        {q.fileTypes?.length
                          ? `Allowed: ${q.fileTypes.join(", ")}. `
                          : ""}
                        {q.fileMaxMb ? `Max size: ${q.fileMaxMb} MB.` : ""}
                      </Text>
                    </View>
                  )}

                  {work.markedQuestions && (() => {
                    const mark = work.markedQuestions.find(
                      (mq) => mq.questionId === q.id,
                    );
                    if (!mark) return null;
                    return (
                      <View
                        style={{
                          marginTop: 8,
                          padding: 8,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: colors.border,
                          borderRadius: 6,
                          backgroundColor: colors.muted,
                          gap: 4,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text size="xs" weight="600">
                            Teacher mark
                          </Text>
                          <Text size="xs" weight="600">
                            {mark.points !== null
                              ? `${formatScore(mark.points)}/${formatScore(q.points)} pt`
                              : "Awaiting marking"}
                          </Text>
                        </View>
                        {mark.feedback ? (
                          <Text size="xs" variant="muted">
                            {mark.feedback}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })()}
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
                  disabled={secondsRemaining === 0 || offlineNow}
                >
                  {submitted ? "Try again" : "Submit quiz"}
                </Button>
                {offlineNow && (
                  <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                    Submitting needs a connection, so it is never done
                    offline. Your answers are saved on this device and sync
                    when you're back online; then submit.
                  </Text>
                )}
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
                <>
                <TextArea
                  placeholder="Type your answer here"
                  value={text}
                  editable={open}
                  onChangeText={setText}
                  style={{ minHeight: 140 }}
                />
                {open && textDraft && textDraft.state !== "needs_attention" ? (
                  <Text
                    variant="muted"
                    size="xs"
                    accessibilityLiveRegion="polite"
                  >
                    Draft saved on this device. It isn't on the server until
                    you hand it in.
                  </Text>
                ) : null}
                </>
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

                  {open && offlineNow && (
                    <Text variant="muted" size="xs">
                      Files can't be attached offline: they upload straight to
                      your school. Attach them when you're back online.
                    </Text>
                  )}
                  {open &&
                    !offlineNow &&
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
                <Button
                  onPress={submitAssignment}
                  loading={working}
                  disabled={offlineNow}
                >
                  Hand in
                </Button>
              )}
              {open && offlineNow && (
                <Text variant="muted" size="xs" style={{ textAlign: "center" }}>
                  Handing in needs a connection. Your text is saved on this
                  device until you hand it in.
                </Text>
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
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
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
