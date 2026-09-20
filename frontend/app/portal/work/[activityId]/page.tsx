"use client";

import { useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { uploadResumable } from "@/lib/files/resumable";
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
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { CheckCircle2, Loader2, Paperclip, Upload } from "lucide-react";
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
  /** questionId -> chosen optionId */
  const answers = useSignal<Record<string, string>>({});
  /** questionId -> typed answer, for short-answer questions */
  const written = useSignal<Record<string, string>>({});
  const text = useSignal("");
  const uploading = useSignal(false);
  const uploadProgress = useSignal(0);
  const fileInput = useRef<HTMLInputElement>(null);

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

    const unanswered = w.questions.filter((q) =>
      q.kind === "short_answer"
        ? !written.value[q.id]?.trim()
        : !answers.value[q.id],
    );
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
            answers: w.questions.map((q) =>
              q.kind === "short_answer"
                ? {
                    questionId: q.id,
                    text: written.value[q.id]?.trim() ?? "",
                  }
                : { questionId: q.id, optionId: answers.value[q.id] },
            ),
          },
        },
      );
      toast.success(`Submitted — you scored ${result.score}/${result.points}`);
      // A retake starts blank rather than pre-filled with the last attempt.
      answers.value = {};
      written.value = {};
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      working.value = false;
    }
  }

  async function attachFile(file: File) {
    uploading.value = true;
    uploadProgress.value = 0;
    try {
      await uploadResumable(
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
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to upload",
      );
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
  // A quiz can be sat again while attempts remain; anything else is done once.
  const attemptsLeft =
    w.kind === "quiz" && w.maxAttempts === 0
      ? Infinity
      : Math.max(0, (w.maxAttempts || 1) - (w.attemptsUsed ?? 0));
  const canRetake = w.kind === "quiz" && attemptsLeft > 0;
  const open = w.status === "published" && (!submitted || canRetake);

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
                {q.kind === "short_answer" ? (
                  <Input
                    placeholder="Type your answer"
                    value={written.value[q.id] ?? ""}
                    disabled={!open}
                    onChange={(e) =>
                      (written.value = {
                        ...written.value,
                        [q.id]: e.target.value,
                      })
                    }
                  />
                ) : (
                  q.options.map((o) => {
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
                    })
                )}
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
              {submitted ? "Try again" : "Submit quiz"}
            </Button>
          )}
          {open && (
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
                      Up to 10MB, and an interrupted upload picks up where it
                      stopped. Attaching a file does not hand it in.
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

      {w.status === "closed" && !submitted && (
        <p className="text-center text-sm text-muted-foreground">
          This closed before you handed anything in.
        </p>
      )}
    </div>
  );
}
