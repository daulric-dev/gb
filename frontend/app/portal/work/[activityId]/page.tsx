"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dueLabel, type PortalWorkDetail } from "../../_components/work-types";

export default function PortalWorkDetailPage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ activityId: string }>();
  const activityId = params?.activityId ?? "";

  const work = useSignal<PortalWorkDetail | null>(null);
  const loading = useSignal(true);
  const working = useSignal(false);
  /** questionId -> optionId */
  const answers = useSignal<Record<string, string>>({});
  const text = useSignal("");

  const load = useCallback(() => {
    if (!activityId) return;
    api<PortalWorkDetail>(`/portal/me/activities/${activityId}`)
      .then((data) => {
        work.value = data;
        text.value = data.submission?.textBody ?? "";
      })
      .catch(() => (work.value = null))
      .finally(() => (loading.value = false));
  }, [activityId, work, text, loading]);

  useEffect(() => {
    load();
  }, [load]);

  async function submitQuiz() {
    const w = work.value;
    if (!w) return;

    const unanswered = w.questions.filter((q) => !answers.value[q.id]);
    if (unanswered.length > 0) {
      toast.error(
        `Answer every question first (${unanswered.length} left)`,
      );
      return;
    }

    working.value = true;
    try {
      const result = await api<{ score: number; points: number }>(
        `/portal/me/activities/${activityId}/quiz`,
        {
          method: "POST",
          body: {
            answers: Object.entries(answers.value).map(
              ([questionId, optionId]) => ({ questionId, optionId }),
            ),
          },
        },
      );
      toast.success(`Submitted — you scored ${result.score}/${result.points}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      working.value = false;
    }
  }

  async function submitAssignment() {
    if (!text.value.trim()) {
      toast.error("Write your answer before handing in");
      return;
    }

    working.value = true;
    try {
      await api(`/portal/me/activities/${activityId}/submit`, {
        method: "POST",
        body: { textBody: text.value.trim() },
      });
      toast.success("Handed in");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to hand in");
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
          description="This could not be loaded"
          onBack={() => router.push("/portal/work")}
        />
      </div>
    );
  }

  const w = work.value;
  const submitted = !!w.submission && w.submission.status !== "draft";
  const open = w.status === "published" && !submitted;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={w.title}
        description={`${w.points} points · ${dueLabel(w.dueAt)}`}
        onBack={() => router.push("/portal/work")}
      />

      {submitted && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {w.submission?.status === "graded"
                  ? `Marked: ${w.submission.score}/${w.points}`
                  : "Handed in"}
              </p>
              {w.submission?.feedback && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {w.submission.feedback}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {w.instructions && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            {w.instructions}
          </CardContent>
        </Card>
      )}

      {w.kind === "quiz" ? (
        <div className="space-y-3">
          {w.questions.map((q, i) => (
            <Card key={q.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">
                    {i + 1}. {q.prompt}
                  </CardTitle>
                  <Badge variant="secondary" className="shrink-0">
                    {q.points} pt
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {q.options.map((o) => {
                  const chosen = answers.value[q.id] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={!open}
                      aria-pressed={chosen}
                      onClick={() =>
                        (answers.value = { ...answers.value, [q.id]: o.id })
                      }
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
                })}
              </CardContent>
            </Card>
          ))}

          {open && (
            <Button
              className="w-full"
              onClick={submitQuiz}
              disabled={working.value}
            >
              {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Submit quiz
            </Button>
          )}
          {open && (
            <p className="text-center text-xs text-muted-foreground">
              You get one attempt, and it is marked as soon as you submit.
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
              <p className="text-xs text-muted-foreground">
                File upload is not available here yet — hand the file to your
                teacher, or paste your work above if that is allowed.
              </p>
            )}

            {open && w.allowText && (
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

      {w.status === "closed" && !submitted && (
        <p className="text-center text-sm text-muted-foreground">
          This closed before you handed anything in.
        </p>
      )}
    </div>
  );
}
