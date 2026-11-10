"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  Boxes,
  Calculator,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
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
import { AiQuestionDrafts } from "../_components/AiQuestionDrafts";
import { BankDrawsDialog } from "../_components/BankDrawsDialog";
import { MarksTable } from "../_components/MarksTable";
import { RubricPanel } from "../_components/RubricPanel";
import {
  ACTIVITY_ICON,
  ActivityStatusBadge,
} from "../_components/ActivityStatusBadge";
import type { ActivityDetail, SubmissionRow } from "../_components/types";
import { LockdownMonitorSummary } from "../_components/LockdownPresence";
import { useLiveRoster } from "../_components/use-live-roster";
import { userMessage } from "@/lib/errors";
import { useFeatures } from "@/hooks/use-features";
import { flagsByStudent, similarityApi, type SimilarityFlag } from "@/lib/similarity";
import { PeerReviewPanel } from "../_components/PeerReviewPanel";

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
  const bankDrawsOpen = useSignal(false);
  const { hasFeature } = useFeatures();
  const peerReviewOn = hasFeature("peer_review");
  const similarityOn = hasFeature("similarity_check");
  const aiOn = hasFeature("ai_assistance");
  const similarity = useSignal<Record<string, SimilarityFlag>>({});

  const editing = useSignal(false);
  const draftTitle = useSignal("");
  const draftInstructions = useSignal("");
  const draftPoints = useSignal("");
  const draftDueAt = useSignal("");
  const draftLateUntil = useSignal("");
  const draftLatePenaltyMode = useSignal<"none" | "percent_per_day" | "percent_per_hour">("none");
  const draftLatePenaltyValue = useSignal("");
  const draftLatePenaltyCap = useSignal("");
  const draftAttempts = useSignal("");
  const draftTimeLimit = useSignal("");
  const draftLockdown = useSignal(false);
  const draftShuffleQuestions = useSignal(false);
  const draftShuffleOptions = useSignal(false);
  const draftGroup = useSignal("");
  const draftAllowMultipleFiles = useSignal(false);

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

  // Live refresh for lockdown quizzes: keeps the rows on a failed poll.
  const refreshingRoster = useSignal(false);
  const refreshRoster = useCallback(async () => {
    if (!activityId) return;
    refreshingRoster.value = true;
    try {
      submissions.value = await api<SubmissionRow[]>(
        `/activities/${activityId}/submissions`,
      );
    } finally {
      refreshingRoster.value = false;
    }
  }, [activityId, submissions, refreshingRoster]);
  useLiveRoster({
    enabled:
      activity.value?.kind === "quiz" &&
      !!activity.value.lockdownBrowser &&
      activity.value.status === "published",
    hasActiveAttempt: submissions.value.some(
      (row) => row.submission?.isActiveAttempt,
    ),
    refresh: refreshRoster,
  });

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

  // Teacher-only similarity markers (assignment text and essay answers).
  const activityKind = activity.value?.kind;
  useEffect(() => {
    if (!similarityOn || !activityId || !activityKind || activityKind === "offline") {
      similarity.value = {};
      return;
    }
    similarityApi
      .flags(activityId)
      .then((res) => (similarity.value = flagsByStudent(res.flags)))
      .catch(() => (similarity.value = {}));
  }, [similarityOn, activityId, activityKind, similarity]);

  const backToList = () => router.push(`${base}/assignments`);

  function openEditor() {
    const a = activity.value;
    if (!a) return;
    draftTitle.value = a.title;
    draftInstructions.value = a.instructions ?? "";
    draftPoints.value = String(a.points);
    draftDueAt.value = toLocalInput(a.dueAt);
    draftLateUntil.value = toLocalInput(a.lateUntil ?? null);
    draftLatePenaltyMode.value = a.latePenaltyMode ?? "none";
    draftLatePenaltyValue.value = a.latePenaltyValue !== null && a.latePenaltyValue !== undefined ? String(a.latePenaltyValue) : "";
    draftLatePenaltyCap.value = a.latePenaltyCap !== null && a.latePenaltyCap !== undefined ? String(a.latePenaltyCap) : "";
    draftAttempts.value = String(a.maxAttempts ?? 1);
    draftTimeLimit.value = a.timeLimitMinutes?.toString() ?? "";
    draftLockdown.value = !!a.lockdownBrowser;
    draftShuffleQuestions.value = !!a.shuffleQuestions;
    draftShuffleOptions.value = !!a.shuffleOptions;
    draftGroup.value = a.assignmentGroupId ?? "";
    draftAllowMultipleFiles.value = a.allowMultipleFiles;
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
      toast.error(userMessage(err, "Failed to save"));
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
    const timeLimit = draftTimeLimit.value.trim()
      ? Number(draftTimeLimit.value)
      : null;
    if (
      activity.value?.kind === "quiz" &&
      timeLimit !== null &&
      (!Number.isInteger(timeLimit) || timeLimit < 1 || timeLimit > 1440)
    ) {
      toast.error("Time limit must be between 1 and 1440 minutes");
      return;
    }

    const penaltyVal = draftLatePenaltyValue.value ? Number(draftLatePenaltyValue.value) : null;
    const penaltyCap = draftLatePenaltyCap.value ? Number(draftLatePenaltyCap.value) : null;
    if (draftLatePenaltyMode.value !== "none") {
      if (penaltyVal === null || penaltyVal <= 0 || penaltyVal > 100) {
        toast.error("Late penalty percent must be between 0.01 and 100");
        return;
      }
      if (penaltyCap !== null && (penaltyCap <= 0 || penaltyCap > 100)) {
        toast.error("Late penalty cap must be between 1 and 100");
        return;
      }
    }

    const ok = await patch(
      {
        title: draftTitle.value.trim(),
        instructions: draftInstructions.value.trim(),
        points,
        dueAt: draftDueAt.value
          ? new Date(draftDueAt.value).toISOString()
          : null,
        lateUntil: draftLateUntil.value
          ? new Date(draftLateUntil.value).toISOString()
          : null,
        latePenaltyMode: draftLatePenaltyMode.value,
        latePenaltyValue: draftLatePenaltyMode.value !== "none" ? penaltyVal : null,
        latePenaltyCap: draftLatePenaltyMode.value !== "none" ? penaltyCap : null,
        assignmentGroupId: draftGroup.value || null,
        ...(activity.value?.kind === "assignment"
          ? { allowMultipleFiles: draftAllowMultipleFiles.value }
          : {}),
        ...(activity.value?.kind === "quiz"
          ? {
              maxAttempts: attempts,
              timeLimitMinutes: timeLimit,
              lockdownBrowser: draftLockdown.value,
              shuffleQuestions: draftShuffleQuestions.value,
              shuffleOptions: draftShuffleOptions.value,
            }
          : {}),
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
      toast.error(userMessage(err, `Failed to ${path}`));
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
      toast.error(userMessage(err, "Failed to delete"));
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
      toast.error(userMessage(err, "Failed to add"));
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
              {a.lateUntil ? ` · Late work accepted until ${formatDue(a.lateUntil)}` : ""}
              {a.latePenaltyMode && a.latePenaltyMode !== "none" && a.latePenaltyValue
                ? ` (−${a.latePenaltyValue}% per ${a.latePenaltyMode === "percent_per_hour" ? "hour" : "day"}${a.latePenaltyCap ? `, cap ${a.latePenaltyCap}%` : ""})`
                : ""}
              {a.kind === "quiz" && (a.shuffleQuestions || a.shuffleOptions) ? " · Shuffled" : ""}
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
              {a.kind === "assignment" && a.allowFile && (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="allowMultipleFiles">
                      Allow multiple files
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Students can attach up to 20 files to one submission.
                    </p>
                  </div>
                  <Switch
                    id="allowMultipleFiles"
                    checked={draftAllowMultipleFiles.value}
                    onCheckedChange={(value) =>
                      (draftAllowMultipleFiles.value = value)
                    }
                  />
                </div>
              )}
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
                <>
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
                <div className="space-y-1">
                  <Label htmlFor="quizTimeLimit" className="text-xs">
                    Time limit (minutes)
                  </Label>
                  <Input
                    id="quizTimeLimit"
                    type="number"
                    min={1}
                    max={1440}
                    value={draftTimeLimit.value}
                    onChange={(e) => (draftTimeLimit.value = e.target.value)}
                    placeholder="No time limit"
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="quizLockdown">Lockdown</Label>
                    <p className="text-xs text-muted-foreground">
                      Web: fullscreen, no copy or paste. App: pinned, screenshots and
                      recording blocked. You see when students leave and how often.
                    </p>
                  </div>
                  <Switch
                    id="quizLockdown"
                    checked={draftLockdown.value}
                    onCheckedChange={(value) => (draftLockdown.value = value)}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="quizShuffle">Shuffle questions</Label>
                    <p className="text-xs text-muted-foreground">
                      Randomize the order of questions for each student attempt.
                    </p>
                  </div>
                  <Switch
                    id="quizShuffle"
                    checked={draftShuffleQuestions.value}
                    onCheckedChange={(value) => (draftShuffleQuestions.value = value)}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="quizShuffleOptions">Shuffle options</Label>
                    <p className="text-xs text-muted-foreground">
                      Each student sees multiple choice, multiple select and matching options in
                      their own order. Ordering items are always shuffled.
                    </p>
                  </div>
                  <Switch
                    id="quizShuffleOptions"
                    checked={draftShuffleOptions.value}
                    onCheckedChange={(value) => (draftShuffleOptions.value = value)}
                  />
                </div>
                </>
              )}
            </div>

            <div className="rounded-lg border p-3 space-y-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Late-work policy</p>
                <p className="text-xs text-muted-foreground">
                  Optionally accept work past the due date with an automatic penalty deducted from the mark.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="draftLateUntil" className="text-xs">Accept late work until</Label>
                  <Input
                    id="draftLateUntil"
                    type="datetime-local"
                    value={draftLateUntil.value}
                    onChange={(e) => (draftLateUntil.value = e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="draftLatePenaltyMode" className="text-xs">Penalty mode</Label>
                  <Select
                    value={draftLatePenaltyMode.value}
                    onValueChange={(v) =>
                      (draftLatePenaltyMode.value = v as
                        | "none"
                        | "percent_per_day"
                        | "percent_per_hour")
                    }
                    items={[
                      { value: "none", label: "No penalty" },
                      { value: "percent_per_day", label: "Percent per day late" },
                      { value: "percent_per_hour", label: "Percent per hour late" },
                    ]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No penalty</SelectItem>
                      <SelectItem value="percent_per_day">Percent per day late</SelectItem>
                      <SelectItem value="percent_per_hour">Percent per hour late</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {draftLatePenaltyMode.value !== "none" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="draftLatePenaltyValue" className="text-xs">Penalty (%)</Label>
                    <Input
                      id="draftLatePenaltyValue"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.1"
                      placeholder="e.g. 10"
                      value={draftLatePenaltyValue.value}
                      onChange={(e) => (draftLatePenaltyValue.value = e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="draftLatePenaltyCap" className="text-xs">Maximum penalty cap (%, optional)</Label>
                    <Input
                      id="draftLatePenaltyCap"
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      placeholder="e.g. 50"
                      value={draftLatePenaltyCap.value}
                      onChange={(e) => (draftLatePenaltyCap.value = e.target.value)}
                    />
                  </div>
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
          {a.kind === "assignment" && peerReviewOn && (
            <TabsTrigger value="peer-review">Peer review</TabsTrigger>
          )}
          {a.kind !== "quiz" && (
            <TabsTrigger value="rubric">
              Rubric{rubric.value.rubric ? "" : " (none)"}
            </TabsTrigger>
          )}
        </TabsList>

        {a.kind === "quiz" && (
          <TabsContent value="questions" className="mt-3 space-y-3">
            <Card className="bg-muted/30">
              <CardHeader className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Boxes className="size-4 text-primary" />
                      Question bank draws
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.bankDraws && a.bankDraws.length > 0
                        ? `${a.bankDraws.reduce((sum, d) => sum + d.count, 0)} question(s) drawn from ${a.bankDraws.length} bank(s) per student attempt`
                        : "Draw random questions from question banks for each student attempt."}
                    </p>
                  </div>
                  {canManage && isDraft && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => (bankDrawsOpen.value = true)}
                    >
                      Manage draws
                    </Button>
                  )}
                </div>
              </CardHeader>
              {a.bankDraws && a.bankDraws.length > 0 && (
                <CardContent className="pt-0 pb-3">
                  <ul className="text-xs space-y-1.5 text-muted-foreground border-t pt-2">
                    {a.bankDraws.map((d) => (
                      <li
                        key={d.bankId}
                        className="flex items-center justify-between"
                      >
                        <span className="font-medium text-foreground">
                          {d.bankTitle || "Question bank"}
                        </span>
                        <span>
                          Draw {d.count} question{d.count === 1 ? "" : "s"}
                          {d.available !== undefined ? ` (${d.available} in bank)` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>

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
            {canManage && isDraft && aiOn && (
              <div className="space-y-3">
                <AiQuestionDrafts courseId={course.id} activityId={activityId} onAddedAction={load} />
              </div>
            )}
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
            {(a.questions?.length ?? 0) === 0 && (a.bankDraws?.length ?? 0) === 0 && !(canManage && isDraft) && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No questions.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="marks" className="mt-3">
          {a.kind === "quiz" && a.lockdownBrowser && !isDraft && (
            <LockdownMonitorSummary
              rows={submissions.value}
              refreshing={refreshingRoster.value}
              onRefreshAction={() => {
                void refreshRoster().catch(() =>
                  toast.error("Could not refresh the roster"),
                );
              }}
            />
          )}
          <MarksTable
            activityId={activityId}
            kind={a.kind}
            dueAt={a.dueAt}
            points={a.points}
            rows={submissions.value}
            canGrade
            isDraft={isDraft}
            onRowsChangeAction={(rows) => (submissions.value = rows)}
            lockdownBrowser={a.kind === "quiz" && !!a.lockdownBrowser}
            similarity={similarity.value}
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

        {a.kind === "assignment" && peerReviewOn && (
          <TabsContent value="peer-review" className="mt-3">
            <PeerReviewPanel
              courseId={course.id}
              activityId={activityId}
              dueAt={a.dueAt}
              canManage={canManage}
              base={base}
            />
          </TabsContent>
        )}

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

      <BankDrawsDialog
        open={bankDrawsOpen.value}
        activityId={activityId}
        courseId={course.id}
        initialDraws={a.bankDraws ?? []}
        onOpenChangeAction={(v) => (bankDrawsOpen.value = v)}
        onSavedAction={load}
      />
    </div>
  );
}
