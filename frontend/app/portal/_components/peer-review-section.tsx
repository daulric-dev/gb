"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { CheckCircle2, MessageSquareText } from "lucide-react";
import { formatDue } from "@/lib/courses/format";
import { peerReviewApi, windowLabel, type StudentPeerReview } from "@/lib/peer-review";
import { useFeatures } from "@/hooks/use-features";
import { ReviewView } from "@/components/peer-review/review-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The student's side of an assignment's peer review: classmates' work to
 * review, and (after the window closes) the reviews of their own work.
 * Hidden when peer review is off.
 */
export function PeerReviewSection({ activityId }: { activityId: string }) {
  useSignals();
  const on = useFeatures().hasFeature("peer_review");
  const data = useSignal<StudentPeerReview | null>(null);

  useEffect(() => {
    if (!on || !activityId) return;
    peerReviewApi
      .forActivity(activityId)
      .then((res) => (data.value = res))
      .catch(() => (data.value = null));
  }, [on, activityId, data]);

  const d = data.value;
  if (!on || !d || !d.enabled) return null;
  if (d.assigned.length === 0 && d.received === null && d.state === "open") return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4" aria-hidden />
          Peer review
        </CardTitle>
        <CardDescription>
          {windowLabel(d, formatDue)}
          {d.anonymous ? " · Anonymous" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {d.assigned.length > 0 && (
          <section aria-labelledby="pr-todo" className="space-y-2">
            <h3 id="pr-todo" className="text-sm font-medium">
              Reviews for you to write
            </h3>
            <ul className="space-y-2">
              {d.assigned.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span className="text-sm">
                    Review {a.number}
                    {a.author ? `: ${a.author}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    {a.submittedAt ? (
                      <Badge variant="secondary">
                        <CheckCircle2 className="mr-1 size-3" aria-hidden />
                        Handed in
                      </Badge>
                    ) : (
                      <Badge variant="outline">To do</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={`/portal/peer-reviews/${a.id}`} />}
                    >
                      {d.state === "open" ? (a.submittedAt ? "Edit" : "Write review") : "View"}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="pr-received" className="space-y-2">
          <h3 id="pr-received" className="text-sm font-medium">
            Reviews of your work
          </h3>
          {d.received === null ? (
            <p className="text-sm text-muted-foreground">
              You can read them here when peer review closes ({formatDue(d.closesAt)}).
            </p>
          ) : d.received.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews were handed in for your work.</p>
          ) : (
            d.received.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  Review {r.number}
                  {r.reviewer ? ` by ${r.reviewer}` : ""}
                </p>
                <ReviewView rubric={d.rubric} marks={r.marks} comment={r.comment} />
              </div>
            ))
          )}
        </section>
      </CardContent>
    </Card>
  );
}
