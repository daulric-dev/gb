"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { FileText, Loader2 } from "lucide-react";
import { buildUrl } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { formatDue } from "@/lib/courses/format";
import {
  marksComplete,
  peerReviewApi,
  windowLabel,
  type ReviewMark,
  type ReviewToWrite,
} from "@/lib/peer-review";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Markdown } from "@/components/markdown";
import { ReviewForm } from "@/components/peer-review/review-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The classmate's file through the reviewer-only, sandboxed route. */
async function fetchReviewFile(allocationId: string, fileId: string): Promise<Blob> {
  const res = await fetch(buildUrl(peerReviewApi.fileUrl(allocationId, fileId)), {
    headers: { "X-API-Version": "1" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  return res.blob();
}

const PREVIEW = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/**
 * Write (or read back) one peer review: the classmate's work on one side,
 * the review form on the other. Editable until the window closes.
 */
export default function PeerReviewPage() {
  useSignals();
  const router = useRouter();
  const params = useParams<{ allocationId: string }>();
  const allocationId = params?.allocationId ?? "";
  const data = useSignal<ReviewToWrite | null>(null);
  const loading = useSignal(true);
  const saving = useSignal(false);
  const comment = useSignal("");
  const marks = useSignal<ReviewMark[]>([]);
  const preview = useSignal<{ url: string; type: string; name: string } | null>(null);

  const load = useCallback(() => {
    if (!allocationId) return;
    peerReviewApi
      .review(allocationId)
      .then((res) => {
        data.value = res;
        comment.value = res.review.comment ?? "";
        marks.value = res.review.marks;
      })
      .catch(() => (data.value = null))
      .finally(() => (loading.value = false));
  }, [allocationId, data, comment, marks, loading]);

  useEffect(() => {
    load();
  }, [load]);

  // Free the object URL when leaving the page.
  useEffect(
    () => () => {
      if (preview.peek()) URL.revokeObjectURL(preview.peek()!.url);
    },
    [preview],
  );

  async function openFile(file: { id: string; name: string; contentType: string }) {
    try {
      const blob = await fetchReviewFile(allocationId, file.id);
      const type = (blob.type || file.contentType).split(";")[0].trim().toLowerCase();
      if (PREVIEW.has(type)) {
        if (preview.peek()) URL.revokeObjectURL(preview.peek()!.url);
        preview.value = { url: URL.createObjectURL(new Blob([blob], { type })), type, name: file.name };
      } else {
        downloadBlob(blob, file.name);
      }
    } catch {
      toast.error("Could not open the file");
    }
  }

  async function save(submit: boolean) {
    const d = data.value;
    if (!d) return;
    if (submit && !marksComplete(d.rubric, marks.value)) {
      toast.error("Mark every criterion before handing in");
      return;
    }
    saving.value = true;
    try {
      const res = await peerReviewApi.saveReview(allocationId, {
        comment: comment.value.trim() || null,
        marks: marks.value,
        submit,
      });
      data.value = { ...d, review: res };
      toast.success(submit || res.submittedAt ? "Review handed in" : "Draft saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save your review"));
    } finally {
      saving.value = false;
    }
  }

  if (loading.value) return <Skeleton className="h-64 w-full" />;
  const d = data.value;
  if (!d) {
    return <p className="text-sm text-muted-foreground">This review is not available.</p>;
  }

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`Peer review ${d.number}: ${d.activityTitle}`}
        description={windowLabel({ state: d.state, opensAt: null, closesAt: d.closesAt }, formatDue)}
        onBack={() => router.push(`/portal/work/${d.activityId}`)}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base" translate={d.author ? "no" : undefined}>
              {d.author ? `${d.author}'s work` : "A classmate's work"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {d.instructions && (
              <details className="rounded-md border p-2 text-sm">
                <summary className="cursor-pointer font-medium">Assignment instructions</summary>
                <Markdown>{d.instructions}</Markdown>
              </details>
            )}
            {d.submission.textBody ? (
              <p className="text-sm whitespace-pre-wrap" translate="no">{d.submission.textBody}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No text was handed in.</p>
            )}
            {d.submission.files.length > 0 && (
              <ul className="space-y-1">
                {d.submission.files.map((f) => (
                  <li key={f.id}>
                    <Button variant="outline" size="sm" onClick={() => void openFile(f)} translate="no">
                      <FileText className="mr-1.5 size-4" aria-hidden />
                      {f.name}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {preview.value && (
              <div className="h-[60vh] rounded-md border" translate="no">
                {preview.value.type === "application/pdf" ? (
                  <iframe src={preview.value.url} title={preview.value.name} className="h-full w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.value.url} alt={preview.value.name} className="h-full w-full object-contain" />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Your review
              {d.review.submittedAt ? (
                <Badge variant="secondary">Handed in</Badge>
              ) : (
                <Badge variant="outline">Draft</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReviewForm
              rubric={d.rubric}
              marks={marks.value}
              comment={comment.value}
              disabled={!d.canEdit || saving.value}
              onMarksChange={(m) => (marks.value = m)}
              onCommentChange={(c) => (comment.value = c)}
            />
            {d.canEdit ? (
              <div className="flex flex-wrap gap-2">
                {!d.review.submittedAt && (
                  <Button variant="outline" disabled={saving.value} onClick={() => void save(false)}>
                    Save draft
                  </Button>
                )}
                <Button disabled={saving.value} onClick={() => void save(true)}>
                  {saving.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
                  {d.review.submittedAt ? "Save changes" : "Hand in review"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Peer review has closed; this review can no longer change.</p>
            )}
            <p className="text-xs text-muted-foreground" role="note">
              {d.anonymous
                ? "Your name is not shown to the author. Your teacher can see every review."
                : "The author will see your name. Your teacher can see every review."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
