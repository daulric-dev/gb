"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Archive,
  Eye,
  EyeOff,
  ListChecks,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  SlashIcon,
  Sparkles,
  Table2,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { lateLabel } from "@/lib/courses/late";
import { downloadFromUrl } from "@/lib/download";
import type {
  ActivityKind,
  Rubric,
  RubricAssessment,
  SubmissionStatus,
} from "@/lib/courses/types";
import { formatDue, lateDays } from "@/lib/courses/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LockdownPresence } from "./LockdownPresence";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { SubmissionRow } from "./types";
import { RubricMarkDialog } from "./RubricMarkDialog";
import { QuizAnswersDialog } from "./QuizAnswersDialog";
import { ExtensionActions, ExtensionBadge } from "./ExtensionControls";
import { AccommodationActions, AccommodationBadge } from "./AccommodationControls";
import { SubmissionFileViewerDialog } from "./SubmissionFileViewerDialog";
import { userMessage } from "@/lib/errors";
import { similarityLabel, type SimilarityFlag } from "@/lib/similarity";
import { SimilarityDialog } from "./SimilarityDialog";
import { useFeatures } from "@/hooks/use-features";
import {
  aiErrorMessage,
  aiGradingApi,
  draftBadge,
  type AiDraftSummary,
  type AiGradingOverview,
} from "@/lib/ai";
import { AiGradingDraftDialog, type RubricPrefill } from "./AiGradingDraftDialog";
import { AiGradingBatchControls } from "./AiGradingBatchControls";

/** How often the marks table refreshes AI drafts while a batch runs (ms). */
const AI_BATCH_POLL_MS = 4000;

/** What the grade and excuse endpoints answer with. */
interface MarkResult {
  id: string;
  studentId: string;
  status: SubmissionStatus;
  score: number | null;
  feedback: string | null;
  excused: boolean;
  excusedReason: string | null;
  gradedAt: string | null;
}

function merge(row: SubmissionRow, result: MarkResult): SubmissionRow {
  const base = row.submission ?? {
    id: result.id,
    status: result.status,
    textBody: null,
    fileId: null,
    fileName: null,
    score: null,
    feedback: null,
    submittedAt: null,
    gradedAt: null,
    attemptCount: 0,
    excused: false,
    excusedReason: null,
  };
  return {
    ...row,
    submission: {
      ...base,
      id: result.id,
      status: result.status,
      score: result.score,
      feedback: result.feedback,
      excused: result.excused,
      excusedReason: result.excusedReason,
      gradedAt: result.gradedAt,
    },
  };
}

/**
 * Marking for every kind of work, one row per student in the course. Scores
 * save on blur. Online work shows what was handed in; offline work is just
 * the marks sheet. Excusing keeps the mark but drops it from the total.
 */
export function MarksTable({
  activityId,
  kind,
  dueAt,
  points,
  rows,
  canGrade,
  isDraft,
  onRowsChangeAction,
  rubric = null,
  assessments = {},
  onAssessedAction,
  lockdownBrowser = false,
  similarity = {},
  gradesPublishedAt = null,
  onPublishGradesAction,
  onUnpublishGradesAction,
}: {
  activityId: string;
  kind: ActivityKind;
  dueAt: string | null;
  points: number;
  rows: SubmissionRow[];
  canGrade: boolean;
  isDraft: boolean;
  onRowsChangeAction: (rows: SubmissionRow[]) => void;
  /** The attached rubric, when marking goes criterion by criterion. */
  rubric?: Rubric | null;
  /** Each student's criterion marks, keyed by student id. */
  assessments?: Record<string, RubricAssessment[]>;
  onAssessedAction?: (studentId: string, marks: RubricAssessment[]) => void;
  /** A lockdown quiz: show who is taking it now, away, and how often they left. */
  lockdownBrowser?: boolean;
  /**
   * Teacher-only similarity markers keyed by student (above the school's
   * threshold). A prompt to look, never a verdict; never shown to students.
   */
  similarity?: Record<string, SimilarityFlag>;
  /** When grades were published to students, if at all. */
  gradesPublishedAt?: string | null;
  onPublishGradesAction?: () => void;
  onUnpublishGradesAction?: () => void;
}) {
  useSignals();
  const search = useSignal("");
  const savingId = useSignal<string | null>(null);
  const feedbackFor = useSignal<SubmissionRow | null>(null);
  const feedbackText = useSignal("");
  const excusing = useSignal<SubmissionRow | null>(null);
  const excuseReason = useSignal("");
  const answersFor = useSignal<SubmissionRow | null>(null);
  const rubricFor = useSignal<SubmissionRow | null>(null);
  const fileFor = useSignal<{
    row: SubmissionRow;
    id: string;
    name: string;
    contentType: string;
  } | null>(null);
  const working = useSignal(false);
  const similarFor = useSignal<{ submissionId: string; name: string } | null>(null);
  // AI grading drafts (assignments with handed-in work, ai_assistance on).
  const aiOverview = useSignal<AiGradingOverview | null>(null);
  const aiFor = useSignal<SubmissionRow | null>(null);
  const rubricPrefill = useSignal<RubricPrefill | null>(null);
  const scoreForm = useSignal<{ row: SubmissionRow; score: string; feedback: string } | null>(null);
  const { hasFeature } = useFeatures();

  const editable = canGrade && !isDraft;
  const online = kind !== "offline";
  const aiOn = editable && kind === "assignment" && hasFeature("ai_assistance");
  const batchRunning = aiOverview.value?.batch?.status === "running";

  useEffect(() => {
    if (!aiOn) return;
    let active = true;
    const load = () =>
      aiGradingApi
        .overview(activityId)
        .then((o) => {
          if (active) aiOverview.value = o;
        })
        .catch(() => undefined);
    void load();
    const timer = batchRunning ? setInterval(() => void load(), AI_BATCH_POLL_MS) : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [aiOn, activityId, batchRunning, aiOverview]);

  function setDraftSummary(studentId: string, summary: AiDraftSummary | null) {
    const o = aiOverview.value;
    if (!o) return;
    const rest = o.drafts.filter((d) => d.studentId !== studentId);
    aiOverview.value = { ...o, drafts: summary ? [...rest, summary] : rest };
  }

  /** A saved mark deletes the student's AI draft on the server; drop its badge too. */
  function clearDraft(studentId: string) {
    if (aiOverview.value?.drafts.some((d) => d.studentId === studentId)) setDraftSummary(studentId, null);
  }

  async function saveScoreForm() {
    const form = scoreForm.value;
    if (!form) return;
    const score = Number(form.score);
    if (form.score.trim() === "" || !Number.isFinite(score) || score < 0 || score > points) {
      toast.error(`Enter a score between 0 and ${points}`);
      return;
    }
    working.value = true;
    const ok = await saveGrade(form.row, score, form.feedback.trim());
    working.value = false;
    if (ok) {
      scoreForm.value = null;
      toast.success("Mark saved");
    }
  }

  function replace(result: MarkResult) {
    onRowsChangeAction(
      rows.map((r) => (r.studentId === result.studentId ? merge(r, result) : r)),
    );
  }

  async function saveGrade(
    row: SubmissionRow,
    score: number,
    feedback?: string,
  ): Promise<boolean> {
    savingId.value = row.studentId;
    try {
      const result = await api<MarkResult>(
        `/activities/${activityId}/submissions/${row.studentId}/grade`,
        {
          method: "PATCH",
          body: { score, ...(feedback !== undefined ? { feedback } : {}) },
        },
      );
      replace(result);
      clearDraft(row.studentId);
      return true;
    } catch (err) {
      toast.error(userMessage(err, "Failed to save mark"));
      return false;
    } finally {
      savingId.value = null;
    }
  }

  async function setExcused(row: SubmissionRow, excused: boolean, reason?: string) {
    working.value = true;
    try {
      const result = await api<MarkResult>(
        `/activities/${activityId}/submissions/${row.studentId}/excuse`,
        { method: "PATCH", body: { excused, reason } },
      );
      replace(result);
      toast.success(excused ? `${row.name} excused` : "Counting again");
      excusing.value = null;
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      working.value = false;
    }
  }

  async function saveFeedback() {
    const row = feedbackFor.value;
    if (!row) return;
    const score = row.submission?.score;
    if (score === null || score === undefined) {
      toast.error("Enter a score first");
      return;
    }
    working.value = true;
    const ok = await saveGrade(row, score, feedbackText.value.trim());
    working.value = false;
    if (ok) {
      feedbackFor.value = null;
      toast.success("Feedback saved");
    }
  }

  async function toggleLatePenalty(row: SubmissionRow) {
    const sub = row.submission;
    if (!sub) return;
    const nextWaived = !sub.latePenaltyWaived;
    try {
      const marked = await api<{ score: number | null; latePenaltyWaived: boolean }>(
        `/activities/${activityId}/submissions/${row.studentId}/late-penalty`,
        { method: "PATCH", body: { waived: nextWaived } },
      );
      toast.success(nextWaived ? "Late penalty waived" : "Late penalty applied");
      onRowsChangeAction(
        rows.map((r) =>
          r.studentId === row.studentId
            ? {
                ...r,
                submission: r.submission
                  ? {
                      ...r.submission,
                      latePenaltyWaived: marked.latePenaltyWaived,
                      score: marked.score,
                    }
                  : null,
              }
            : r,
        ),
      );
    } catch (err) {
      toast.error(userMessage(err, "Could not update late penalty"));
    }
  }

  if (rows.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle>No students yet</EmptyTitle>
          <EmptyDescription>
            Add students on the People tab to start marking.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const draftsByStudent = new Map((aiOverview.value?.drafts ?? []).map((d) => [d.studentId, d]));
  const q = search.value.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const marked = rows.filter(
    (r) => r.submission?.score !== null && r.submission?.score !== undefined,
  );
  const scored = marked.filter((r) => !r.submission?.excused);
  const average = scored.length
    ? scored.reduce((s, r) => s + (r.submission!.score ?? 0), 0) / scored.length
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Find a student"
            className="w-56 pl-8"
            value={search.value}
            onChange={(e) => (search.value = e.target.value)}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {marked.length}/{rows.length} marked
          {average !== null &&
            ` · average ${Math.round(average * 10) / 10}/${points}`}
        </span>
        {!isDraft && canGrade && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                gradesPublishedAt
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }
            >
              {gradesPublishedAt ? "Grades published" : "Grades unpublished"}
            </Badge>
            {gradesPublishedAt ? (
              onUnpublishGradesAction && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={onUnpublishGradesAction}
                >
                  <EyeOff className="mr-1.5 size-3.5" />
                  Unpublish
                </Button>
              )
            ) : (
              onPublishGradesAction && (
                <Button
                  size="xs"
                  onClick={onPublishGradesAction}
                >
                  <Send className="mr-1.5 size-3.5" />
                  Publish grades
                </Button>
              )
            )}
          </div>
        )}
        {aiOn && aiOverview.value && (
          <div className="ml-auto">
            <AiGradingBatchControls
              activityId={activityId}
              batch={aiOverview.value.batch}
              problem={aiOverview.value.setup.problem}
              onBatchAction={(batch) => {
                if (aiOverview.value) aiOverview.value = { ...aiOverview.value, batch };
                void aiGradingApi
                  .overview(activityId)
                  .then((o) => (aiOverview.value = o))
                  .catch((err) => toast.error(aiErrorMessage(err)));
              }}
            />
          </div>
        )}
      </div>

      {isDraft && canGrade && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Publish this first. Marks can be entered once it is published.
        </p>
      )}

      {!isDraft && !gradesPublishedAt && canGrade && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <EyeOff className="size-4 shrink-0" />
            <span>
              Grades are unpublished. Students cannot see scores or feedback until you publish grades.
            </span>
          </div>
          {onPublishGradesAction && (
            <Button
              size="sm"
              onClick={onPublishGradesAction}
            >
              <Send className="mr-1.5 size-3.5" />
              Publish grades to students
            </Button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              {online && <TableHead>Handed in</TableHead>}
              <TableHead className="w-40">Score</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const sub = row.submission;
              const handedIn = !!sub && sub.status !== "draft" && !!sub.submittedAt;
              const excused = !!sub?.excused;
              const lateBy =
                kind === "assignment"
                  ? lateDays(
                      row.effectiveDueAt !== undefined ? row.effectiveDueAt : dueAt,
                      sub?.submittedAt ?? null,
                    )
                  : null;
              return (
                <TableRow
                  key={row.studentId}
                  className={cn(
                    row.enrollmentStatus &&
                      row.enrollmentStatus !== "active" &&
                      "opacity-60",
                  )}
                >
                  <TableCell className="align-top">
                    <p className="font-medium" translate="no">{row.name}</p>
                    {online && <ExtensionBadge extension={row.extension} />}
                    {kind === "quiz" && (
                      <AccommodationBadge accommodation={row.accommodation} />
                    )}
                    {lockdownBrowser && <LockdownPresence submission={sub} />}
                    {similarity[row.studentId] && (
                      <p className="mt-1">
                        <button
                          type="button"
                          className="rounded-sm text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          aria-label={`${similarityLabel(similarity[row.studentId])}. Compare ${row.name}'s text`}
                          data-private-label
                          onClick={() =>
                            (similarFor.value = {
                              submissionId: similarity[row.studentId].submissionId,
                              name: row.name,
                            })
                          }
                        >
                          {similarityLabel(similarity[row.studentId])}
                        </button>
                      </p>
                    )}
                    {(() => {
                      const badge = aiOn ? draftBadge(draftsByStudent.get(row.studentId)) : null;
                      if (!badge) return null;
                      return (
                        <p className="mt-1">
                          <button
                            type="button"
                            onClick={() => (aiFor.value = row)}
                            className="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                            aria-label={`${badge.label}: open the AI draft for ${row.name}`}
                            data-private-label
                          >
                            <Badge
                              variant="outline"
                              className={cn(
                                badge.tone === "ready" && "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300",
                                badge.tone === "busy" && "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
                                badge.tone === "problem" && "border-destructive/40 text-destructive",
                                badge.tone === "muted" && "text-muted-foreground",
                              )}
                            >
                              <Sparkles className="mr-1 size-3" aria-hidden />
                              <span translate="no">{badge.label}</span>
                            </Badge>
                          </button>
                        </p>
                      );
                    })()}
                    {sub?.needsMarking && (
                      <p className="mt-1">
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                          Needs marking
                        </Badge>
                      </p>
                    )}
                    {row.enrollmentStatus && row.enrollmentStatus !== "active" && (
                      <p className="text-xs capitalize text-muted-foreground">
                        {row.enrollmentStatus}
                      </p>
                    )}
                    {excused && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <SlashIcon className="size-3" />
                        Excused
                        {sub?.excusedReason ? <span translate="no">{` - ${sub.excusedReason}`}</span> : ""}
                      </p>
                    )}
                    {sub?.feedback && (
                      <p className="mt-0.5 line-clamp-1 max-w-xs text-xs text-muted-foreground" translate="no">
                        &ldquo;{sub.feedback}&rdquo;
                      </p>
                    )}
                  </TableCell>
                  {online && (
                    <TableCell className="max-w-xs align-top">
                      {!handedIn ? (
                        <Badge variant="secondary">Not handed in</Badge>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            {formatDue(sub!.submittedAt)}
                            {sub!.attemptCount > 1 &&
                              ` · attempt ${sub!.attemptCount}`}
                          </p>
                          {((sub?.lateSeconds ?? 0) > 0 || lateBy !== null) && (
                            <div className="space-y-0.5">
                              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                {(sub?.lateSeconds ?? 0) > 0
                                  ? lateLabel(sub!.lateSeconds!)
                                  : `Late (${lateBy} ${lateBy === 1 ? "day" : "days"})`}
                              </p>
                              {(sub?.latePenaltyPercent ?? 0) > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  {sub?.latePenaltyWaived ? (
                                    <span className="text-muted-foreground line-through">
                                      −{sub.latePenaltyPercent}% late penalty (waived)
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 dark:text-amber-400" translate="no">
                                      {sub?.rawScore !== null && sub?.rawScore !== undefined ? `${sub.rawScore} − ` : ""}
                                      {sub?.latePenaltyPercent}% late = {sub?.score}
                                    </span>
                                  )}
                                  {editable && (
                                    <button
                                      type="button"
                                      className="text-[11px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
                                      onClick={() => void toggleLatePenalty(row)}
                                    >
                                      {sub?.latePenaltyWaived ? "Apply penalty" : "Waive penalty"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {sub!.textBody && (
                            <p className="line-clamp-2 whitespace-pre-wrap text-sm" translate="no">
                              {sub!.textBody}
                            </p>
                          )}
                          {sub!.fileId && (
                            <div className="flex flex-wrap gap-1">
                              {(sub!.files?.length
                                ? sub!.files
                                : [
                                    {
                                      id: sub!.fileId,
                                      name: sub!.fileName ?? "Submission file",
                                      contentType: "application/octet-stream",
                                    },
                                  ]
                              ).map((file) => (
                                <Button
                                  key={file.id}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label={`View ${file.name}`}
                                  data-private-label
                                  onClick={() =>
                                    (fileFor.value = {
                                      row,
                                      id: file.id,
                                      name: file.name,
                                      contentType: file.contentType,
                                    })
                                  }
                                >
                                  <Eye className="mr-1.5 size-3.5" />
                                  <span className="max-w-32 truncate" translate="no">
                                    {file.name}
                                  </span>
                                </Button>
                              ))}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label="Download all submission files as ZIP"
                                title="Download all files as ZIP"
                                onClick={() =>
                                  downloadFromUrl(
                                    `/activities/submissions/${sub!.id}/files.zip`,
                                    `${row.name} - submission.zip`,
                                  ).catch(() =>
                                    toast.error("Failed to download submission"),
                                  )
                                }
                              >
                                <Archive className="mr-1.5 size-3.5" />
                                ZIP
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="align-top">
                    {sub?.fileId ? (
                      <div className="flex items-center gap-2">
                        <span className={cn(excused && "line-through opacity-60")} translate="no">
                          {sub.score ?? "—"}/{points}
                        </span>
                        {editable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`${sub.score === null ? "Enter" : "Edit"} grade for ${row.name}`}
                            data-private-label
                            onClick={() => {
                              const file = sub.files?.[0];
                              if (file) {
                                fileFor.value = {
                                  row,
                                  id: file.id,
                                  name: file.name,
                                  contentType: file.contentType,
                                };
                              } else if (sub.fileId) {
                                fileFor.value = {
                                  row,
                                  id: sub.fileId,
                                  name: sub.fileName ?? "Submission file",
                                  contentType: "application/octet-stream",
                                };
                              }
                            }}
                          >
                            {sub.score === null ? "Enter grade" : "Edit grade"}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          key={`${row.studentId}-${sub?.score ?? ""}`}
                          type="number"
                          min={0}
                          step={0.01}
                          aria-label={`Score for ${row.name}`}
                          data-private-label
                          defaultValue={sub?.score ?? ""}
                          disabled={
                            !editable || savingId.value === row.studentId
                          }
                          className={cn(
                            "h-8 w-20",
                            excused && "line-through opacity-60",
                          )}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") return;
                            const score = Number(raw);
                            if (!Number.isFinite(score) || score < 0) {
                              toast.error("Enter a score of 0 or more");
                              e.target.value = String(sub?.score ?? "");
                              return;
                            }
                            if (score !== sub?.score) void saveGrade(row, score);
                          }}
                        />
                        <span className="text-xs text-muted-foreground">
                          /{points}
                        </span>
                        {savingId.value === row.studentId && (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {editable && (
                      <div className="flex justify-end gap-1">
                        {kind === "quiz" && (
                          <AccommodationActions
                            activityId={activityId}
                            row={row}
                            onChangedAction={(changed) =>
                              onRowsChangeAction(
                                rows.map((r) =>
                                  r.studentId === changed.studentId ? changed : r,
                                ),
                              )
                            }
                          />
                        )}
                        {online && (
                          <ExtensionActions
                            activityId={activityId}
                            activityDueAt={dueAt}
                            row={row}
                            onChangedAction={(changed) =>
                              onRowsChangeAction(
                                rows.map((r) =>
                                  r.studentId === changed.studentId ? changed : r,
                                ),
                              )
                            }
                          />
                        )}
                        {kind === "quiz" && sub && (sub.status !== "draft" || sub.attemptCount > 0) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Answers and question marks"
                            aria-label={`Answers and question marks for ${row.name}`}
                            data-private-label
                            onClick={() => (answersFor.value = row)}
                          >
                            <ListChecks className="size-4" aria-hidden />
                          </Button>
                        )}
                        {aiOn && handedIn && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Draft with AI"
                            aria-label={`Draft a mark with AI for ${row.name}`}
                            data-private-label
                            onClick={() => (aiFor.value = row)}
                          >
                            <Sparkles className="size-4" aria-hidden />
                          </Button>
                        )}
                        {rubric && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Mark with the rubric"
                            onClick={() => (rubricFor.value = row)}
                          >
                            <Table2 className="size-4" />
                            {assessments[row.studentId]?.length ? (
                              <span className="sr-only">Rubric marked</span>
                            ) : null}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Feedback"
                          onClick={() => {
                            feedbackText.value = sub?.feedback ?? "";
                            feedbackFor.value = row;
                          }}
                        >
                          <MessageSquareText className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={working.value}
                          onClick={() => {
                            if (excused) void setExcused(row, false);
                            else {
                              excuseReason.value = "";
                              excusing.value = row;
                            }
                          }}
                        >
                          {excused ? "Un-excuse" : "Excuse"}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {kind === "quiz" && (
        <QuizAnswersDialog
          activityId={activityId}
          student={answersFor.value}
          onOpenChangeAction={(v) => {
            if (!v) answersFor.value = null;
          }}
          onMarkedAction={(studentId, marked) =>
            onRowsChangeAction(
              rows.map((r) =>
                r.studentId === studentId && r.submission
                  ? {
                      ...r,
                      submission: {
                        ...r.submission,
                        status: marked.status,
                        score: marked.score,
                        needsMarking: marked.status === "submitted",
                      },
                    }
                  : r,
              ),
            )
          }
        />
      )}

      {rubric && (
        <RubricMarkDialog
          open={!!rubricFor.value}
          activityId={activityId}
          points={points}
          rubric={rubric}
          student={rubricFor.value}
          existing={
            rubricFor.value ? (assessments[rubricFor.value.studentId] ?? []) : []
          }
          feedback={rubricFor.value?.submission?.feedback ?? null}
          prefill={rubricPrefill.value}
          onOpenChangeAction={(v) => {
            if (!v) {
              rubricFor.value = null;
              rubricPrefill.value = null;
            }
          }}
          onSavedAction={(result) => {
            replace(result.submission);
            clearDraft(result.submission.studentId);
            onAssessedAction?.(result.submission.studentId, result.assessments);
          }}
        />
      )}

      {aiOn && (
        <AiGradingDraftDialog
          open={!!aiFor.value}
          activityId={activityId}
          student={aiFor.value}
          rubric={rubric}
          points={points}
          onOpenChangeAction={(v) => {
            if (!v) aiFor.value = null;
          }}
          onChangedAction={setDraftSummary}
          onApplyRubricAction={(prefill) => {
            const row = aiFor.value;
            aiFor.value = null;
            rubricPrefill.value = prefill;
            rubricFor.value = row;
          }}
          onApplyScoreAction={(prefill) => {
            const row = aiFor.value;
            aiFor.value = null;
            if (row) {
              scoreForm.value = {
                row,
                score: prefill.score === null ? "" : String(prefill.score),
                feedback: prefill.feedback,
              };
            }
          }}
        />
      )}

      <Dialog
        open={!!scoreForm.value}
        onOpenChange={(v) => {
          if (!v) scoreForm.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark <span translate="no">{scoreForm.value?.row.name}</span>
            </DialogTitle>
            <DialogDescription>
              Filled in from the AI draft you reviewed. Change anything you need; the student sees the
              mark and feedback only once you save.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Label htmlFor="aiScoreFormScore" className="text-sm">
              Score
            </Label>
            <Input
              id="aiScoreFormScore"
              inputMode="decimal"
              className="w-24"
              value={scoreForm.value?.score ?? ""}
              onChange={(e) => scoreForm.value && (scoreForm.value = { ...scoreForm.value, score: e.target.value })}
              translate="no"
            />
            <span className="text-sm text-muted-foreground">/{points}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aiScoreFormFeedback" className="text-xs">
              Feedback
            </Label>
            <Textarea
              id="aiScoreFormFeedback"
              rows={5}
              value={scoreForm.value?.feedback ?? ""}
              onChange={(e) => scoreForm.value && (scoreForm.value = { ...scoreForm.value, feedback: e.target.value })}
              translate="no"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => (scoreForm.value = null)} disabled={working.value}>
              Cancel
            </Button>
            <Button onClick={() => void saveScoreForm()} disabled={working.value}>
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save mark
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!feedbackFor.value}
        onOpenChange={(v) => {
          if (!v) feedbackFor.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle translate="no">Feedback for {feedbackFor.value?.name}</DialogTitle>
            <DialogDescription>
              The student sees this with their mark.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={5}
            value={feedbackText.value}
            onChange={(e) => (feedbackText.value = e.target.value)}
            placeholder="Well argued - next time cite your sources."
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (feedbackFor.value = null)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button onClick={saveFeedback} disabled={working.value}>
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fileFor.value && (
        <SubmissionFileViewerDialog
          key={fileFor.value.id}
          file={{
            id: fileFor.value.id,
            name: fileFor.value.name,
            contentType: fileFor.value.contentType,
            submissionId: fileFor.value.row.submission!.id,
          }}
          score={fileFor.value.row.submission!.score}
          points={points}
          canGrade={editable}
          saving={savingId.value === fileFor.value.row.studentId}
          onSaveGrade={(score) => saveGrade(fileFor.value!.row, score)}
          onClose={() => (fileFor.value = null)}
        />
      )}

      {similarFor.value && (
        <SimilarityDialog
          activityId={activityId}
          submissionId={similarFor.value.submissionId}
          studentName={similarFor.value.name}
          onCloseAction={() => (similarFor.value = null)}
        />
      )}

      <Dialog
        open={!!excusing.value}
        onOpenChange={(v) => {
          if (!v) excusing.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excuse {excusing.value?.name}</DialogTitle>
            <DialogDescription>
              Any mark is kept and stays visible here, but it stops counting
              toward the course grade until you un-excuse it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="excuseReason" className="text-xs">
              Reason (optional)
            </Label>
            <Textarea
              id="excuseReason"
              rows={3}
              placeholder="Absent with a note"
              value={excuseReason.value}
              onChange={(e) => (excuseReason.value = e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (excusing.value = null)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                void setExcused(
                  excusing.value!,
                  true,
                  excuseReason.value.trim() || undefined,
                )
              }
              disabled={working.value}
            >
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Excuse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
