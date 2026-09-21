"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { usePermissions } from "@/providers/PermissionsProvider";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calculator,
  Download,
  Loader2,
  Pencil,
  Send,
  SlashIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildUrl } from "@/lib/api";
import { downloadBlob } from "@/lib/reports/download";
import {
  formatDue,
  STATUS_LABEL,
  type ActivityDetail,
  type SubmissionRow,
} from "../_components/types";
import { QuestionCard } from "../_components/QuestionCard";
import {
  QuestionForm,
  type QuestionPayload,
} from "../_components/QuestionForm";

/**
 * The handed-in file. It is streamed through the backend rather than linked
 * directly: the student owns the file, and the teacher's access comes from
 * owning the class, which only the API can decide.
 */
async function downloadSubmissionFile(submissionId: string, name: string) {
  const res = await fetch(
    buildUrl(`/activities/submissions/${submissionId}/file`),
    { headers: { "X-API-Version": "1" }, credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to download (${res.status})`);
  downloadBlob(await res.blob(), name);
}

/** An ISO instant as the local wall clock a datetime-local input expects. */
function toLocalInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ActivityDetailPage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ classId: string; activityId: string }>();
  const classId = params?.classId ?? "";
  const activityId = params?.activityId ?? "";
  const { can } = usePermissions();

  const activity = useSignal<ActivityDetail | null>(null);
  const submissions = useSignal<SubmissionRow[]>([]);
  const loading = useSignal(true);
  const working = useSignal(false);

  // editing the title and description
  const editingDetails = useSignal(false);
  const draftTitle = useSignal("");
  const draftInstructions = useSignal("");
  const draftPoints = useSignal("");
  const draftDueAt = useSignal("");
  const draftAttempts = useSignal("");

  // Excluding one student's mark: the row being edited, and its reason.
  const excludingStudent = useSignal<SubmissionRow | null>(null);
  const exclusionReason = useSignal("");

  const load = useCallback(() => {
    if (!activityId) return;
    api<ActivityDetail>(`/activities/${activityId}`)
      .then((data) => (activity.value = data))
      .catch(() => (activity.value = null))
      .finally(() => (loading.value = false));
  }, [activityId, activity, loading]);

  const loadSubmissions = useCallback(() => {
    if (!activityId) return;
    api<SubmissionRow[]>(`/activities/${activityId}/submissions`)
      .then((data) => (submissions.value = data))
      .catch(() => (submissions.value = []));
  }, [activityId, submissions]);

  useEffect(() => {
    load();
    loadSubmissions();
  }, [load, loadSubmissions]);

  function openDetails() {
    const a = activity.value;
    if (!a) return;
    draftTitle.value = a.title;
    draftInstructions.value = a.instructions ?? "";
    draftPoints.value = String(a.points);
    // datetime-local wants the local wall clock with no zone, so trim the ISO
    // string rather than round-tripping through toISOString, which would shift
    // the displayed time by the offset.
    draftDueAt.value = a.dueAt ? toLocalInput(a.dueAt) : "";
    draftAttempts.value = String(a.maxAttempts ?? 1);
    editingDetails.value = true;
  }

  // Renaming is allowed after publishing - unlike questions, it changes
  // nothing that has already been marked - and the backend keeps the
  // gradebook's copy of the title in step.
  async function saveDetails() {
    if (!draftTitle.value.trim()) {
      toast.error("Give it a title");
      return;
    }

    working.value = true;
    try {
      const points = Number(draftPoints.value);
      if (!Number.isFinite(points) || points < 1) {
        toast.error("Points must be at least 1");
        return;
      }

      const attempts = Number(draftAttempts.value);
      if (!Number.isInteger(attempts) || attempts < 0) {
        toast.error("Attempts must be 0 or more");
        return;
      }

      await api(`/activities/${activityId}`, {
        method: "PATCH",
        body: {
          title: draftTitle.value.trim(),
          instructions: draftInstructions.value.trim(),
          points,
          dueAt: draftDueAt.value
            ? new Date(draftDueAt.value).toISOString()
            : null,
          ...(activity.value?.kind === "quiz"
            ? { maxAttempts: attempts }
            : {}),
        },
      });
      editingDetails.value = false;
      toast.success("Saved");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      working.value = false;
    }
  }

  // Excluding keeps the marks but drops their effect on the term - the escape
  // hatch for work that went wrong, short of deleting it and the submissions.
  async function setExcluded(excluded: boolean) {
    working.value = true;
    try {
      await api(`/activities/${activityId}/exclude`, {
        method: "POST",
        body: { excluded },
      });
      toast.success(
        excluded ? "Left out of the grade" : "Counting towards the grade",
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      working.value = false;
    }
  }

  /**
   * The same escape hatch, for one student. The activity-wide toggle covers
   * work that went wrong; this covers a result that did - absent for the test,
   * sat a makeup - where the mark is worth keeping but not counting.
   */
  async function setStudentExcluded(
    studentId: string,
    excluded: boolean,
    reason?: string,
  ) {
    working.value = true;
    try {
      await api(`/activities/${activityId}/students/${studentId}/exclude`, {
        method: "POST",
        body: { excluded, reason },
      });
      toast.success(
        excluded ? "Mark left out of the grade" : "Mark counting again",
      );
      excludingStudent.value = null;
      exclusionReason.value = "";
      loadSubmissions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      working.value = false;
    }
  }

  async function addQuestion(payload: QuestionPayload) {
    working.value = true;
    try {
      await api(`/activities/${activityId}/questions`, {
        method: "POST",
        body: payload,
      });
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      working.value = false;
    }
  }




  async function publish() {
    working.value = true;
    try {
      await api(`/activities/${activityId}/publish`, {
        method: "POST",
        body: {},
      });
      toast.success("Published — students can see it now");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish");
    } finally {
      working.value = false;
    }
  }

  async function close() {
    working.value = true;
    try {
      await api(`/activities/${activityId}/close`, { method: "POST", body: {} });
      toast.success("Closed to new submissions");
      load();
    } catch {
      toast.error("Failed to close");
    } finally {
      working.value = false;
    }
  }

  async function grade(submissionId: string, score: number) {
    try {
      await api(`/activities/submissions/${submissionId}/grade`, {
        method: "POST",
        body: { score },
      });
      toast.success("Mark saved");
      loadSubmissions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save mark");
    }
  }

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!activity.value) {
    return (
      <div className="space-y-6">
        <BackTitleToolbar
          title="Work"
          description="This item could not be loaded"
          onBack={() => router.push(`/dashboard/classes/${classId}/activities`)}
        />
      </div>
    );
  }

  const a = activity.value;
  const isDraft = a.status === "draft";
  const canEdit = can("assessment", "update");
  const handedIn = submissions.value.filter(
    (s) => s.submission && s.submission.status !== "draft",
  ).length;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={a.title}
        description={`${a.kind === "quiz" ? "Quiz" : "Assignment"} · ${a.points} points · ${formatDue(a.dueAt)}`}
        onBack={() => router.push(`/dashboard/classes/${classId}/activities`)}
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <Badge variant={isDraft ? "secondary" : "default"}>
                {STATUS_LABEL[a.status]}
              </Badge>
              {!editingDetails.value && (
                <Button variant="outline" onClick={openDetails}>
                  <Pencil className="mr-2 size-4" />
                  Edit
                </Button>
              )}
              {isDraft && (
                <Button onClick={publish} disabled={working.value}>
                  {working.value ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 size-4" />
                  )}
                  Publish
                </Button>
              )}
              {a.status === "published" && (
                <Button variant="outline" onClick={close} disabled={working.value}>
                  Close
                </Button>
              )}
              {!isDraft && (
                <Button
                  variant="outline"
                  onClick={() => setExcluded(!a.isExcluded)}
                  disabled={working.value}
                >
                  <Calculator className="mr-2 size-4" />
                  {a.isExcluded ? "Count it" : "Do not count"}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {editingDetails.value ? (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Title and description</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="activityTitle" className="text-xs">
                Title
              </Label>
              <Input
                id="activityTitle"
                value={draftTitle.value}
                onChange={(e) => (draftTitle.value = e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="activityInstructions" className="text-xs">
                Description
              </Label>
              <Textarea
                id="activityInstructions"
                rows={4}
                placeholder="What students need to know before they start"
                value={draftInstructions.value}
                onChange={(e) => (draftInstructions.value = e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="activityDue" className="text-xs">
                  Due
                </Label>
                <Input
                  id="activityDue"
                  type="datetime-local"
                  value={draftDueAt.value}
                  onChange={(e) => (draftDueAt.value = e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="activityPoints" className="text-xs">
                  Points
                </Label>
                <Input
                  id="activityPoints"
                  type="number"
                  min={1}
                  value={draftPoints.value}
                  onChange={(e) => (draftPoints.value = e.target.value)}
                />
              </div>
              {a.kind === "quiz" && (
                <div className="space-y-1">
                  <Label htmlFor="activityAttempts" className="text-xs">
                    Attempts
                  </Label>
                  <Input
                    id="activityAttempts"
                    type="number"
                    min={0}
                    value={draftAttempts.value}
                    onChange={(e) => (draftAttempts.value = e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    0 for unlimited
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => (editingDetails.value = false)}
                disabled={working.value}
              >
                Cancel
              </Button>
              <Button onClick={saveDetails} disabled={working.value}>
                {working.value && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        a.instructions && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              {a.instructions}
            </CardContent>
          </Card>
        )
      )}

      {a.isExcluded && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            Not counted towards the term grade. The marks are kept, and
            &ldquo;Count it&rdquo; puts them back.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={a.kind === "quiz" ? "questions" : "submissions"}>
        <TabsList className="w-full">
          {a.kind === "quiz" && (
            <TabsTrigger value="questions">
              Questions ({a.questions.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="submissions">
            Submissions ({handedIn}/{submissions.value.length})
          </TabsTrigger>
        </TabsList>

        {a.kind === "quiz" && (
          <TabsContent value="questions" className="mt-4 space-y-3">
            {a.questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={i}
                activityId={activityId}
                canEdit={canEdit && isDraft}
                onChangedAction={load}
              />
            ))}

            {canEdit && isDraft && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Add a question</CardTitle>
                </CardHeader>
                <CardContent>
                  <QuestionForm
                    key={a.questions.length}
                    submitLabel="Add"
                    busy={working.value}
                    onSubmitAction={addQuestion}
                  />
                </CardContent>
              </Card>
            )}

            {a.questions.length === 0 && !isDraft && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No questions.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="submissions" className="mt-4 space-y-2">
          {submissions.value.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nobody is enrolled in this class yet.
              </CardContent>
            </Card>
          ) : (
            submissions.value.map((row) => (
              <Card key={row.studentId}>
                <CardContent className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.name}
                  </span>

                  {!row.submission || row.submission.status === "draft" ? (
                    <Badge variant="secondary">Not handed in</Badge>
                  ) : (
                    <>
                      {row.submission.textBody && (
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {row.submission.textBody}
                        </span>
                      )}
                      {row.submission.fileId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => {
                            const name =
                              row.submission?.fileName ?? "submission";
                            downloadSubmissionFile(
                              row.submission!.id,
                              name,
                            ).catch(() => toast.error("Failed to download"));
                          }}
                        >
                          <Download className="mr-2 size-4" />
                          <span className="max-w-32 truncate">
                            {row.submission.fileName ?? "File"}
                          </span>
                        </Button>
                      )}
                      <Badge
                        variant={
                          row.submission.status === "graded"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {row.submission.status === "graded"
                          ? `${row.submission.score}/${a.points}`
                          : "Submitted"}
                      </Badge>
                      {can("grade", "update") && a.kind === "assignment" && (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={a.points}
                            defaultValue={row.submission.score ?? ""}
                            className="h-8 w-20"
                            onBlur={(e) => {
                              const score = Number(e.target.value);
                              if (
                                Number.isFinite(score) &&
                                score !== row.submission?.score
                              ) {
                                void grade(row.submission!.id, score);
                              }
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            /{a.points}
                          </span>
                        </div>
                      )}

                      {/* Only once there is a gradebook row to act on. Before
                          that there is no mark to leave out of anything. */}
                      {can("grade", "update") && row.grade && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          disabled={working.value}
                          onClick={() => {
                            if (row.grade!.isExcluded) {
                              void setStudentExcluded(row.studentId, false);
                            } else {
                              exclusionReason.value = "";
                              excludingStudent.value = row;
                            }
                          }}
                        >
                          {row.grade.isExcluded ? "Count it" : "Do not count"}
                        </Button>
                      )}

                      {row.grade?.isExcluded && (
                        <div className="flex w-full items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
                          <SlashIcon className="size-3.5 shrink-0" />
                          <span className="truncate">
                            Not counted towards the term
                            {row.grade.exclusionReason
                              ? ` — ${row.grade.exclusionReason}`
                              : ""}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!excludingStudent.value}
        onOpenChange={(open) => {
          if (!open) excludingStudent.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Leave {excludingStudent.value?.name}&apos;s mark out
            </DialogTitle>
            <DialogDescription>
              The mark is kept and stays visible here. It stops counting
              towards the term grade until you put it back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="exclusionReason" className="text-xs">
              Reason (optional)
            </Label>
            <Textarea
              id="exclusionReason"
              rows={3}
              placeholder="Absent, sat the makeup instead"
              value={exclusionReason.value}
              onChange={(e) => (exclusionReason.value = e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (excludingStudent.value = null)}
              disabled={working.value}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                void setStudentExcluded(
                  excludingStudent.value!.studentId,
                  true,
                  exclusionReason.value.trim() || undefined,
                )
              }
              disabled={working.value}
            >
              {working.value && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Do not count it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
