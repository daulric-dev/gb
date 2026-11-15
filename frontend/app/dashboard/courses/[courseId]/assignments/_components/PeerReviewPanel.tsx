"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Eye, EyeOff, Loader2, Play, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { Rubric } from "@/lib/courses/types";
import { formatDue, toLocalInput } from "@/lib/courses/format";
import {
  peerReviewApi,
  progressByReviewer,
  windowLabel,
  type PeerReviewOverview,
  type StaffReview,
} from "@/lib/peer-review";
import { ReviewView } from "@/components/peer-review/review-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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

/**
 * Peer review for one assignment (teacher): settings, the window, every
 * allocation with its review, reassigning, and hiding a review.
 */
export function PeerReviewPanel({
  courseId,
  activityId,
  dueAt,
  canManage,
  base,
}: {
  courseId: string;
  activityId: string;
  dueAt: string | null;
  canManage: boolean;
  base: string;
}) {
  useSignals();
  const data = useSignal<PeerReviewOverview | null>(null);
  const rubrics = useSignal<Rubric[]>([]);
  const saving = useSignal(false);

  const enabled = useSignal(true);
  const perStudent = useSignal("2");
  const anonymous = useSignal(true);
  const openMode = useSignal<"after_due" | "manual">(dueAt ? "after_due" : "manual");
  const closesAt = useSignal("");
  const rubricId = useSignal("");
  const qualityCounts = useSignal(false);
  const qualityPoints = useSignal("10");

  const viewing = useSignal<StaffReview | null>(null);
  const hiding = useSignal<StaffReview | null>(null);
  const hideReason = useSignal("");
  const addReviewer = useSignal("");
  const addSubmission = useSignal("");

  const apply = useCallback(
    (res: PeerReviewOverview) => {
      data.value = res;
      const s = res.settings;
      if (!s) return;
      enabled.value = s.enabled;
      perStudent.value = String(s.reviewsPerStudent);
      anonymous.value = s.anonymous;
      openMode.value = s.openMode;
      closesAt.value = toLocalInput(s.closesAt);
      rubricId.value = s.rubricId ?? "";
      qualityCounts.value = s.qualityPoints !== null;
      qualityPoints.value = String(s.qualityPoints ?? 10);
    },
    [data, enabled, perStudent, anonymous, openMode, closesAt, rubricId, qualityCounts, qualityPoints],
  );

  const load = useCallback(() => {
    peerReviewApi
      .overview(activityId)
      .then(apply)
      .catch((err) => toast.error(userMessage(err, "Could not load peer review")));
  }, [activityId, apply]);

  useEffect(() => {
    load();
    api<Rubric[]>(`/courses/${courseId}/rubrics`)
      .then((r) => (rubrics.value = r))
      .catch(() => (rubrics.value = []));
  }, [load, courseId, rubrics]);

  async function run(action: () => Promise<unknown>, success: string) {
    saving.value = true;
    try {
      const res = await action();
      if (res && typeof res === "object" && "activityId" in res) apply(res as PeerReviewOverview);
      else load();
      toast.success(success);
    } catch (err) {
      toast.error(userMessage(err, "That did not work"));
    } finally {
      saving.value = false;
    }
  }

  const save = () => {
    const closes = new Date(closesAt.value);
    if (!closesAt.value || Number.isNaN(closes.getTime())) {
      toast.error("Choose when peer review closes");
      return;
    }
    void run(
      () =>
        peerReviewApi.save(activityId, {
          enabled: enabled.value,
          reviewsPerStudent: Number(perStudent.value),
          anonymous: anonymous.value,
          openMode: openMode.value,
          closesAt: closes.toISOString(),
          rubricId: rubricId.value || null,
          qualityPoints: qualityCounts.value ? Number(qualityPoints.value) : null,
        }),
      "Peer review saved",
    );
  };

  const d = data.value;
  if (!d) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto size-4 animate-spin" aria-label="Loading" />
        </CardContent>
      </Card>
    );
  }
  const s = d.settings;
  const progress = progressByReviewer(d.reviews);
  const started = !!s?.startedAt;
  const editable = canManage && !saving.value;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Peer review</CardTitle>
          <CardDescription>
            Each student who handed in reviews classmates&rsquo; work. Excused students and those
            with nothing handed in are left out; students who hand in later are added while the
            window is open.
            {s && (
              <span className="mt-1 block font-medium text-foreground">
                {s.enabled ? windowLabel(s, formatDue) : "Turned off"}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              id="pr-enabled"
              checked={enabled.value}
              disabled={!editable}
              onCheckedChange={(v) => (enabled.value = v)}
            />
            <Label htmlFor="pr-enabled">Peer review on</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pr-count">Reviews per student</Label>
              <Input
                id="pr-count"
                type="number"
                min={1}
                max={10}
                value={perStudent.value}
                disabled={!editable}
                onChange={(e) => (perStudent.value = e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-open">Opens</Label>
              <NativeSelect
                id="pr-open"
                className="w-full"
                value={openMode.value}
                disabled={!editable || started}
                onChange={(e) => (openMode.value = e.target.value as "after_due" | "manual")}
              >
                <NativeSelectOption value="after_due" disabled={!dueAt}>
                  After the due date
                </NativeSelectOption>
                <NativeSelectOption value="manual">When I start it</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-closes">Closes</Label>
              <Input
                id="pr-closes"
                type="datetime-local"
                value={closesAt.value}
                disabled={!editable}
                onChange={(e) => (closesAt.value = e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-rubric">Review form</Label>
              <NativeSelect
                id="pr-rubric"
                className="w-full"
                value={rubricId.value}
                disabled={!editable}
                onChange={(e) => (rubricId.value = e.target.value)}
              >
                <NativeSelectOption value="">Comments only</NativeSelectOption>
                {rubrics.value.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    Rubric: {r.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="pr-anon"
              checked={anonymous.value}
              disabled={!editable || (started && s?.anonymous)}
              onCheckedChange={(v) => (anonymous.value = v)}
            />
            <Label htmlFor="pr-anon">Anonymous (reviewers and authors never see each other&rsquo;s names)</Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              id="pr-quality"
              checked={qualityCounts.value}
              disabled={!editable}
              onCheckedChange={(v) => (qualityCounts.value = v)}
            />
            <Label htmlFor="pr-quality">Review quality counts:</Label>
            <Input
              id="pr-quality-points"
              aria-label="Points for review quality"
              type="number"
              min={0.01}
              max={1000}
              className="w-24"
              value={qualityPoints.value}
              disabled={!editable || !qualityCounts.value}
              onChange={(e) => (qualityPoints.value = e.target.value)}
            />
            <span className="text-sm text-muted-foreground">points, in its own gradebook column</span>
          </div>
          {s?.qualityActivityId && (
            <p className="text-sm">
              Mark each reviewer in{" "}
              <Link className="underline" href={`${base}/assignments/${s.qualityActivityId}`}>
                the review-quality column
              </Link>
              .
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={!editable}>
                {saving.value && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
                Save
              </Button>
              {s?.enabled && s.state !== "closed" && (
                <Button
                  variant="outline"
                  disabled={!editable}
                  onClick={() =>
                    void run(
                      () => peerReviewApi.start(activityId),
                      started ? "Late submitters allocated" : "Peer review started",
                    )
                  }
                >
                  <Play className="mr-1.5 size-4" aria-hidden />
                  {started ? "Allocate late submitters" : "Start now"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {started && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reviews ({d.reviews.filter((r) => r.submittedAt).length}/{d.reviews.length} handed in)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reviewer</TableHead>
                    <TableHead>Reviewing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.reviews.map((r) => {
                    const p = r.reviewer ? progress.get(r.reviewer.id) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell translate="no">
                          {canManage && !r.submittedAt ? (
                            <NativeSelect
                              size="sm"
                              aria-label={`Reviewer of ${r.author?.name ?? "this submission"}`}
                              value={r.reviewer?.id ?? ""}
                              disabled={!editable}
                              onChange={(e) =>
                                void run(
                                  () => peerReviewApi.reassign(activityId, r.id, e.target.value),
                                  "Review reassigned",
                                )
                              }
                            >
                              {d.submitters
                                .filter((x) => x.studentId !== r.author?.id)
                                .map((x) => (
                                  <NativeSelectOption key={x.studentId} value={x.studentId}>
                                    {x.name}
                                  </NativeSelectOption>
                                ))}
                            </NativeSelect>
                          ) : (
                            r.reviewer?.name
                          )}
                          {p && <span className="ml-2 text-xs text-muted-foreground">{p.done}/{p.total} done</span>}
                        </TableCell>
                        <TableCell translate="no">{r.author?.name}</TableCell>
                        <TableCell>
                          {r.hidden ? (
                            <Badge variant="outline">
                              <EyeOff className="mr-1 size-3" aria-hidden />
                              Hidden
                            </Badge>
                          ) : r.submittedAt ? (
                            <Badge variant="secondary">Handed in{r.score !== null ? ` · ${r.score}` : ""}</Badge>
                          ) : (
                            <Badge variant="outline">Not yet</Badge>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => (viewing.value = r)}>
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={r.hidden ? `Show review by ${r.reviewer?.name}` : `Hide review by ${r.reviewer?.name}`}
                            data-private-label
                            disabled={saving.value}
                            onClick={() => {
                              if (r.hidden) {
                                void run(() => peerReviewApi.hide(activityId, r.id, false), "Review shown to its author");
                              } else {
                                hideReason.value = "";
                                hiding.value = r;
                              }
                            }}
                          >
                            {r.hidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                          </Button>
                          {canManage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove review by ${r.reviewer?.name}`}
                              data-private-label
                              disabled={!editable}
                              onClick={() => void run(() => peerReviewApi.remove(activityId, r.id), "Review removed")}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {canManage && d.submitters.length > 1 && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="pr-add-reviewer">Add a reviewer</Label>
                  <NativeSelect
                    id="pr-add-reviewer"
                    value={addReviewer.value}
                    onChange={(e) => (addReviewer.value = e.target.value)}
                  >
                    <NativeSelectOption value="">Choose a student</NativeSelectOption>
                    {d.submitters.map((x) => (
                      <NativeSelectOption key={x.studentId} value={x.studentId}>
                        {x.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pr-add-submission">to review the work of</Label>
                  <NativeSelect
                    id="pr-add-submission"
                    value={addSubmission.value}
                    onChange={(e) => (addSubmission.value = e.target.value)}
                  >
                    <NativeSelectOption value="">Choose a submission</NativeSelectOption>
                    {d.submitters
                      .filter((x) => x.studentId !== addReviewer.value)
                      .map((x) => (
                        <NativeSelectOption key={x.submissionId} value={x.submissionId}>
                          {x.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </div>
                <Button
                  variant="outline"
                  disabled={!editable || !addReviewer.value || !addSubmission.value}
                  onClick={() =>
                    void run(
                      () => peerReviewApi.add(activityId, addReviewer.value, addSubmission.value),
                      "Review added",
                    )
                  }
                >
                  <UserPlus className="mr-1.5 size-4" aria-hidden />
                  Add
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!viewing.value} onOpenChange={(o) => !o && (viewing.value = null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" translate="no">
          <DialogHeader>
            <DialogTitle>
              {viewing.value?.reviewer?.name} reviewing {viewing.value?.author?.name}
            </DialogTitle>
            <DialogDescription>
              {viewing.value?.submittedAt ? `Handed in ${formatDue(viewing.value.submittedAt)}` : "Not handed in yet (draft)"}
              {viewing.value?.hidden && ` · Hidden from the author${viewing.value.hiddenReason ? `: ${viewing.value.hiddenReason}` : ""}`}
            </DialogDescription>
          </DialogHeader>
          {viewing.value && (
            <ReviewView rubric={d.rubric} marks={viewing.value.marks} comment={viewing.value.comment} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!hiding.value} onOpenChange={(o) => !o && (hiding.value = null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hide this review?</DialogTitle>
            <DialogDescription>
              Its author will not see it. The reviewer and other staff still can, and hiding is
              recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="pr-hide-reason">Reason (optional)</Label>
          <Textarea
            id="pr-hide-reason"
            maxLength={500}
            value={hideReason.value}
            onChange={(e) => (hideReason.value = e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => (hiding.value = null)}>
              Cancel
            </Button>
            <Button
              disabled={saving.value}
              onClick={() => {
                const r = hiding.value;
                hiding.value = null;
                if (r) void run(() => peerReviewApi.hide(activityId, r.id, true, hideReason.value), "Review hidden");
              }}
            >
              Hide review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
