"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Download,
  Loader2,
  MessageSquareText,
  Search,
  SlashIcon,
  Users,
} from "lucide-react";
import { api, ApiError, buildUrl } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import type { ActivityKind, SubmissionStatus } from "@/lib/courses/types";
import { formatDue } from "@/lib/courses/format";
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

/**
 * The handed-in file is streamed through the backend rather than linked
 * directly: the student owns it, and the teacher's access comes from the
 * course, which only the API can decide.
 */
async function downloadSubmissionFile(submissionId: string, name: string) {
  const res = await fetch(
    buildUrl(`/activities/submissions/${submissionId}/file`),
    { headers: { "X-API-Version": "1" }, credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to download (${res.status})`);
  downloadBlob(await res.blob(), name);
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
  points,
  rows,
  canGrade,
  isDraft,
  onRowsChangeAction,
}: {
  activityId: string;
  kind: ActivityKind;
  points: number;
  rows: SubmissionRow[];
  canGrade: boolean;
  isDraft: boolean;
  onRowsChangeAction: (rows: SubmissionRow[]) => void;
}) {
  useSignals();
  const search = useSignal("");
  const savingId = useSignal<string | null>(null);
  const feedbackFor = useSignal<SubmissionRow | null>(null);
  const feedbackText = useSignal("");
  const excusing = useSignal<SubmissionRow | null>(null);
  const excuseReason = useSignal("");
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
                          {sub!.textBody && (
                            <p className="line-clamp-2 whitespace-pre-wrap text-sm">
                              {sub!.textBody}
                            </p>
                          )}
                          {sub!.fileId && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                downloadSubmissionFile(
                                  sub!.id,
                                  sub!.fileName ?? "submission",
                                ).catch(() => toast.error("Failed to download"))
                              }
                            >
                              <Download className="mr-1.5 size-3.5" />
                              <span className="max-w-32 truncate">
                                {sub!.fileName ?? "File"}
                              </span>
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="align-top">
                    <div className="flex items-center gap-1.5">
                      <Input
                        key={`${row.studentId}-${sub?.score ?? ""}`}
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`Score for ${row.name}`}
                        defaultValue={sub?.score ?? ""}
                        disabled={!editable || savingId.value === row.studentId}
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
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {editable && (
                      <div className="flex justify-end gap-1">
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
