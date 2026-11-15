"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, Info, Loader2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  matchSource,
  similarityApi,
  type Segment,
  type SimilarityComparison,
  type SimilarityMatch,
} from "@/lib/similarity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Passage({ segments, label }: { segments: Segment[]; label: string }) {
  return (
    <div
      className="max-h-[50vh] overflow-y-auto rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap"
      tabIndex={0}
      aria-label={label}
    >
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </div>
  );
}

/**
 * Teacher-only: the submissions one student's text is similar to, and a
 * side-by-side view with the shared passages highlighted. Worded as a prompt
 * to look, never as proof.
 */
export function SimilarityDialog({
  activityId,
  submissionId,
  studentName,
  onCloseAction,
}: {
  activityId: string;
  submissionId: string;
  studentName: string;
  onCloseAction: () => void;
}) {
  useSignals();
  const matches = useSignal<SimilarityMatch[] | null>(null);
  const note = useSignal("");
  const comparison = useSignal<SimilarityComparison | null>(null);
  const loading = useSignal(false);

  useEffect(() => {
    similarityApi
      .matches(activityId, submissionId)
      .then((res) => {
        matches.value = res.matches;
        note.value = res.note;
      })
      .catch((err) => {
        matches.value = [];
        toast.error(userMessage(err, "Could not load similar submissions"));
      });
  }, [activityId, submissionId, matches, note]);

  async function open(m: SimilarityMatch) {
    loading.value = true;
    try {
      comparison.value = await similarityApi.compare(activityId, m.fingerprintId, m.otherId);
    } catch (err) {
      toast.error(userMessage(err, "Could not load the comparison"));
    } finally {
      loading.value = false;
    }
  }

  const c = comparison.value;
  return (
    <Dialog open onOpenChange={(o) => !o && onCloseAction()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl" translate="no">
        <DialogHeader>
          <DialogTitle>Similar text: {studentName}</DialogTitle>
          <DialogDescription className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {note.value ||
                "Similarity is a prompt to look, not proof of copying. It never changes a grade and students never see it."}
            </span>
          </DialogDescription>
        </DialogHeader>

        {c ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => (comparison.value = null)}>
              <ArrowLeft className="mr-1.5 size-4" aria-hidden />
              All matches
            </Button>
            <p className="text-sm">
              About {c.score}% of {c.left.studentName}&rsquo;s text also appears in the other
              submission. Highlighted passages are shared.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{c.left.studentName}</h3>
                <Passage segments={c.left.segments} label={`Text by ${c.left.studentName}`} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-medium">
                  {c.right.studentName ?? "A student in another course"} · {c.right.activityTitle} ({c.right.courseName})
                </h3>
                {!c.right.canView && (
                  <p className="text-xs text-muted-foreground">
                    You do not teach this course, so only the shared passages are shown.
                  </p>
                )}
                <Passage segments={c.right.segments} label="The other submission" />
              </div>
            </div>
          </div>
        ) : matches.value === null ? (
          <Loader2 className="mx-auto size-5 animate-spin" aria-label="Loading" />
        ) : matches.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing above the school&rsquo;s threshold.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {matches.value.map((m) => (
              <li key={`${m.fingerprintId}-${m.otherId}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="text-sm">
                  <p className="font-medium">{matchSource(m)}</p>
                  <p className="text-muted-foreground">
                    {m.partLabel} · {m.score}% of this text found there
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={loading.value} onClick={() => void open(m)}>
                  Compare side by side
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
