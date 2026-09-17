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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import {
  formatDue,
  STATUS_LABEL,
  type ActivityDetail,
  type SubmissionRow,
} from "../_components/types";

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

  // new question
  const prompt = useSignal("");
  const optionA = useSignal("");
  const optionB = useSignal("");
  const optionC = useSignal("");
  const optionD = useSignal("");
  const correct = useSignal(0);
  const questionPoints = useSignal("1");

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

  async function addQuestion() {
    const labels = [optionA, optionB, optionC, optionD]
      .map((s) => s.value.trim())
      .filter(Boolean);

    if (!prompt.value.trim()) {
      toast.error("Write the question");
      return;
    }
    if (labels.length < 2) {
      toast.error("Give at least two options");
      return;
    }
    if (correct.value >= labels.length) {
      toast.error("Mark which option is correct");
      return;
    }

    working.value = true;
    try {
      await api(`/activities/${activityId}/questions`, {
        method: "POST",
        body: {
          prompt: prompt.value.trim(),
          kind: "multiple_choice",
          points: Number(questionPoints.value) || 1,
          options: labels.map((label, i) => ({
            label,
            isCorrect: i === correct.value,
          })),
        },
      });
      prompt.value = "";
      optionA.value = "";
      optionB.value = "";
      optionC.value = "";
      optionD.value = "";
      correct.value = 0;
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add");
    } finally {
      working.value = false;
    }
  }

  async function removeQuestion(questionId: string) {
    try {
      await api(`/activities/${activityId}/questions/${questionId}`, {
        method: "DELETE",
      });
      load();
    } catch {
      toast.error("Failed to remove question");
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
            </div>
          ) : undefined
        }
      />

      {a.instructions && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            {a.instructions}
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
              <Card key={q.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">
                      {i + 1}. {q.prompt}
                    </CardTitle>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary">{q.points} pt</Badge>
                      {canEdit && isDraft && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeQuestion(q.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 pt-0">
                  {q.options.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      {o.isCorrect ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : (
                        <X className="size-4 opacity-30" />
                      )}
                      {o.label}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}

            {canEdit && isDraft && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Add a question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    rows={2}
                    placeholder="What is 2 + 2?"
                    value={prompt.value}
                    onChange={(e) => (prompt.value = e.target.value)}
                  />
                  {[optionA, optionB, optionC, optionD].map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => (correct.value = i)}
                        aria-label={`Mark option ${i + 1} correct`}
                        className={`flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          correct.value === i
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Check className="size-4" />
                      </button>
                      <Input
                        placeholder={`Option ${i + 1}${i > 1 ? " (optional)" : ""}`}
                        value={opt.value}
                        onChange={(e) => (opt.value = e.target.value)}
                      />
                    </div>
                  ))}
                  <div className="flex items-end gap-2">
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Points</Label>
                      <Input
                        type="number"
                        min={1}
                        value={questionPoints.value}
                        onChange={(e) => (questionPoints.value = e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={addQuestion}
                      disabled={working.value}
                      className="ml-auto"
                    >
                      <Plus className="mr-2 size-4" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tick the circle beside the correct answer. Questions can
                    only change while this is a draft.
                  </p>
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
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
