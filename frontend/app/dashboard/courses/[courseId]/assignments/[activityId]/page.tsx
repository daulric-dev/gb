"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  Calculator,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ActivityRubric, AssignmentGroup } from "@/lib/courses/types";
import {
  ACTIVITY_KIND_LABEL,
  formatDue,
  toLocalInput,
} from "@/lib/courses/format";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useCourse } from "../../_components/course-context";
import { MarkdownEditor } from "../../_components/MarkdownEditor";
import { QuestionCard } from "../_components/QuestionCard";
import { QuestionForm, type QuestionPayload } from "../_components/QuestionForm";
import { MarksTable } from "../_components/MarksTable";
import { RubricPanel } from "../_components/RubricPanel";
import {
  ACTIVITY_ICON,
  ActivityStatusBadge,
} from "../_components/ActivityStatusBadge";
import type { ActivityDetail, SubmissionRow } from "../_components/types";

const UNGROUPED = "none";

export default function CourseActivityPage() {
  useSignals();
  const router = useRouter();
  const params = useParams<{ activityId: string }>();
  const activityId = params?.activityId ?? "";
  const { course, base, canManage } = useCourse();

  const activity = useSignal<ActivityDetail | null>(null);
  const submissions = useSignal<SubmissionRow[]>([]);
  const groups = useSignal<AssignmentGroup[]>([]);
  const rubric = useSignal<ActivityRubric>({ rubric: null, assessments: {} });
  const loading = useSignal(true);
  const working = useSignal(false);
  const confirmDelete = useSignal(false);

  const editing = useSignal(false);
  const draftTitle = useSignal("");
  const draftInstructions = useSignal("");
  const draftPoints = useSignal("");
  const draftDueAt = useSignal("");
  const draftAttempts = useSignal("");
  const draftGroup = useSignal("");

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

  const loadRubric = useCallback(() => {
    if (!activityId) return;
    api<ActivityRubric>(`/activities/${activityId}/rubric`)
      .then((data) => (rubric.value = data))
      .catch(() => (rubric.value = { rubric: null, assessments: {} }));
  }, [activityId, rubric]);

  useEffect(() => {
    load();
    loadSubmissions();
    loadRubric();
    api<AssignmentGroup[]>(`/courses/${course.id}/assignment-groups`)
      .then((data) => (groups.value = data))
      .catch(() => (groups.value = []));
  }, [load, loadSubmissions, loadRubric, course.id, groups]);

  const backToList = () => router.push(`${base}/assignments`);

  function openEditor() {
    const a = activity.value;
    if (!a) return;
    draftTitle.value = a.title;
    draftInstructions.value = a.instructions ?? "";
    draftPoints.value = String(a.points);
    draftDueAt.value = toLocalInput(a.dueAt);
    draftAttempts.value = String(a.maxAttempts ?? 1);
    draftGroup.value = a.assignmentGroupId ?? "";
    editing.value = true;
  }

  async function patch(body: Record<string, unknown>, success?: string) {
    working.value = true;
    try {
      await api(`/activities/${activityId}`, { method: "PATCH", body });
      if (success) toast.success(success);
      load();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
      return false;
    } finally {
      working.value = false;
    }
  }

  async function saveDetails() {
    if (!draftTitle.value.trim()) {
      toast.error("Give it a title");
      return;
    }
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

    const ok = await patch(
      {
        title: draftTitle.value.trim(),
        instructions: draftInstructions.value.trim(),
        points,
        dueAt: draftDueAt.value
          ? new Date(draftDueAt.value).toISOString()
          : null,
        assignmentGroupId: draftGroup.value || null,
        ...(activity.value?.kind === "quiz" ? { maxAttempts: attempts } : {}),
      },
      "Saved",
    );
    if (ok) editing.value = false;
  }

  async function action(path: "publish" | "close", success: string) {
    working.value = true;
    try {
      await api(`/activities/${activityId}/${path}`, {
        method: "POST",
        body: {},
      });
      toast.success(success);
      load();
      loadSubmissions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${path}`);
    } finally {
      working.value = false;
    }
  }

  async function remove() {
    try {
      await api(`/activities/${activityId}`, { method: "DELETE" });
      toast.success("Deleted");
      backToList();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete");
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

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!activity.value) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={backToList}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          Assignments
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            This item could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  const a = activity.value;
  const Icon = ACTIVITY_ICON[a.kind];
  const isDraft = a.status === "draft";
  const group = groups.value.find((g) => g.id === a.assignmentGroupId);
  const handedIn = submissions.value.filter(
    (s) => s.submission?.submittedAt && s.submission.status !== "draft",
  ).length;
  const marked = submissions.value.filter(
    (s) => s.submission?.score !== null && s.submission?.score !== undefined,
  ).length;

  const groupItems = [
    { value: UNGROUPED, label: "Ungrouped" },
    ...groups.value.map((g) => ({
      value: g.id,
      label: g.weight !== null ? `${g.name} (${g.weight}%)` : g.name,
    })),
  ];

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={backToList}
      >
        <ArrowLeft className="mr-1.5 size-4" />
        Assignments
      </Button>

      <div className="flex animate-fade-in-up flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold">{a.title}</h2>
            <p className="text-sm text-muted-foreground">
              {ACTIVITY_KIND_LABEL[a.kind]} · {a.points} points ·{" "}
              {formatDue(a.dueAt)}
              {group ? ` · ${group.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityStatusBadge status={a.status} />
          {canManage && isDraft && (
            <Button
              onClick={() =>
                action(
                  "publish",
                  a.kind === "offline"
                    ? "Published. You can enter marks now."
                    : "Published. Students can see it now.",
                )
              }
              disabled={working.value}
            >
              {working.value ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Publish
            </Button>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="More" />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={openEditor}>
                  <Pencil className="mr-2 size-4" />
                  Edit details
                </DropdownMenuItem>
                {a.status === "published" && a.kind !== "offline" && (
                  <DropdownMenuItem
                    onClick={() => action("close", "Closed to new submissions")}
                  >
                    <Lock className="mr-2 size-4" />
                    Close submissions
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() =>
                    patch(
                      { omitFromFinalGrade: !a.omitFromFinalGrade },
                      a.omitFromFinalGrade
                        ? "Counting toward the final grade"
                        : "Left out of the final grade",
                    )
                  }
                >
                  <Calculator className="mr-2 size-4" />
                  {a.omitFromFinalGrade
                    ? "Count toward final grade"
                    : "Omit from final grade"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => (confirmDelete.value = true)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {a.omitFromFinalGrade && (
        <Card size="sm" className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="text-sm">
            Omitted from the final grade. Marks are kept and shown, but do not
            count toward the course total.
          </CardContent>
        </Card>
      )}

      {editing.value ? (
        <Card className="animate-fade-in-up border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <Label className="text-xs">Instructions</Label>
              <MarkdownEditor
                value={draftInstructions.value}
                onChangeAction={(v) => (draftInstructions.value = v)}
                rows={6}
                placeholder="What students need to know before they start"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="space-y-1">
                <Label className="text-xs">Group</Label>
                <Select
                  value={draftGroup.value || UNGROUPED}
                  onValueChange={(v) =>
                    (draftGroup.value = v === UNGROUPED ? "" : (v as string))
                  }
                  items={groupItems}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groupItems.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {a.kind === "quiz" && (
                <div className="space-y-1">
                  <Label htmlFor="activityAttempts" className="text-xs">
                    Attempts (0 = unlimited)
                  </Label>
                  <Input
                    id="activityAttempts"
                    type="number"
                    min={0}
                    value={draftAttempts.value}
                    onChange={(e) => (draftAttempts.value = e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => (editing.value = false)}
                disabled={working.value}
              >
                Cancel
              </Button>
              <Button onClick={saveDetails} disabled={working.value}>
                {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        a.instructions?.trim() && (
          <Card className="animate-fade-in-up-delay-1">
            <CardContent>
              <Markdown>{a.instructions}</Markdown>
            </CardContent>
          </Card>
        )
      )}

      <Tabs defaultValue={a.kind === "quiz" && isDraft ? "questions" : "marks"}>
        <TabsList>
          {a.kind === "quiz" && (
            <TabsTrigger value="questions">
              Questions ({a.questions?.length ?? 0})
            </TabsTrigger>
          )}
          <TabsTrigger value="marks">
            {a.kind === "offline"
              ? `Marks (${marked}/${submissions.value.length})`
              : `Submissions (${handedIn}/${submissions.value.length})`}
          </TabsTrigger>
          {a.kind !== "quiz" && (
            <TabsTrigger value="rubric">
              Rubric{rubric.value.rubric ? "" : " (none)"}
            </TabsTrigger>
          )}
        </TabsList>

        {a.kind === "quiz" && (
          <TabsContent value="questions" className="mt-3 space-y-3">
            {(a.questions ?? []).map((q, i) => (
              <QuestionCard
                key={q.id}
                question={q}
                index={i}
                activityId={activityId}
                canEdit={canManage && isDraft}
                onChangedAction={load}
              />
            ))}
            {canManage && isDraft && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add a question</CardTitle>
                </CardHeader>
                <CardContent>
                  <QuestionForm
                    key={a.questions?.length ?? 0}
                    submitLabel="Add"
                    busy={working.value}
                    onSubmitAction={addQuestion}
                  />
                </CardContent>
              </Card>
            )}
            {(a.questions?.length ?? 0) === 0 && !(canManage && isDraft) && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No questions.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="marks" className="mt-3">
          <MarksTable
            activityId={activityId}
            kind={a.kind}
            points={a.points}
            rows={submissions.value}
            canGrade
            isDraft={isDraft}
            onRowsChangeAction={(rows) => (submissions.value = rows)}
            rubric={a.kind === "quiz" ? null : rubric.value.rubric}
            assessments={rubric.value.assessments}
            onAssessedAction={(studentId, marks) => {
              // The rubric is now in use, so its criteria are locked.
              rubric.value = {
                rubric: rubric.value.rubric
                  ? { ...rubric.value.rubric, assessed: true }
                  : null,
                assessments: { ...rubric.value.assessments, [studentId]: marks },
              };
            }}
          />
        </TabsContent>

        {a.kind !== "quiz" && (
          <TabsContent value="rubric" className="mt-3">
            <RubricPanel
              courseId={course.id}
              activityId={activityId}
              points={a.points}
              rubric={rubric.value.rubric}
              canManage={canManage}
              onChangedAction={() => {
                loadRubric();
                load();
              }}
            />
          </TabsContent>
        )}
      </Tabs>

      <AlertDialog
        open={confirmDelete.value}
        onOpenChange={(v) => (confirmDelete.value = v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{a.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Every submission and mark for it goes too. To keep the marks but
              stop them counting, omit it from the final grade instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
