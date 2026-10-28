"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Archive,
  Eye,
  Loader2,
  MessageSquareText,
  Search,
  SlashIcon,
  Table2,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
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
import { SubmissionFileViewerDialog } from "./SubmissionFileViewerDialog";

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
}) {
  useSignals();
  const search = useSignal("");
  const savingId = useSignal<string | null>(null);
  const feedbackFor = useSignal<SubmissionRow | null>(null);
  const feedbackText = useSignal("");
  const excusing = useSignal<SubmissionRow | null>(null);
  const excuseReason = useSignal("");
  const rubricFor = useSignal<SubmissionRow | null>(null);
  const fileFor = useSignal<{
    row: SubmissionRow;
    id: string;
    name: string;
    contentType: string;
  } | null>(null);
  const working = useSignal(false);

  const editable = canGrade && !isDraft;
  const online = kind !== "offline";

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
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save mark");
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
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
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
      </div>

      {isDraft && canGrade && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Publish this first. Marks can be entered once it is published.
        </p>
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
                  ? lateDays(dueAt, sub?.submittedAt ?? null)
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
                    <p className="font-medium">{row.name}</p>
                    {row.enrollmentStatus && row.enrollmentStatus !== "active" && (
                      <p className="text-xs capitalize text-muted-foreground">
                        {row.enrollmentStatus}
                      </p>
                    )}
                    {excused && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                        <SlashIcon className="size-3" />
                        Excused
                        {sub?.excusedReason ? ` - ${sub.excusedReason}` : ""}
                      </p>
                    )}
                    {sub?.feedback && (
                      <p className="mt-0.5 line-clamp-1 max-w-xs text-xs text-muted-foreground">
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
                          {lateBy !== null && (
                              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                {lateBy} {lateBy === 1 ? "day" : "days"} late
                              </p>
                            )}
                          {sub!.textBody && (
                            <p className="line-clamp-2 whitespace-pre-wrap text-sm">
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
                                  <span className="max-w-32 truncate">
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
                        <span className={cn(excused && "line-through opacity-60")}>
                          {sub.score ?? "—"}/{points}
                        </span>
                        {editable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`${sub.score === null ? "Enter" : "Edit"} grade for ${row.name}`}
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
          onOpenChangeAction={(v) => {
            if (!v) rubricFor.value = null;
          }}
          onSavedAction={(result) => {
            replace(result.submission);
            onAssessedAction?.(result.submission.studentId, result.assessments);
          }}
        />
      )}

      <Dialog
        open={!!feedbackFor.value}
        onOpenChange={(v) => {
          if (!v) feedbackFor.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Feedback for {feedbackFor.value?.name}</DialogTitle>
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
