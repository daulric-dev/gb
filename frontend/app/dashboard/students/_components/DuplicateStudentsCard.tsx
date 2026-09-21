"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Merge, Users } from "lucide-react";

interface DuplicateCandidate {
  joinedId: string;
  existingId: string;
  name: string;
}

/**
 * Students who joined with the school code while the roster already held a
 * record under their name.
 *
 * The code cannot know who someone is, so this is the cost of letting students
 * in without staff creating the record first. Merging moves their login onto
 * the record that holds their grades and drops the empty one created at join
 * time; nothing here blocks the student, who is already using the app.
 */
export function DuplicateStudentsCard({
  canMerge,
  onMergedAction,
}: {
  canMerge: boolean;
  onMergedAction?: () => void;
}) {
  useSignals();

  const candidates = useSignal<DuplicateCandidate[]>([]);
  const merging = useSignal<string | null>(null);

  const load = useCallback(() => {
    api<DuplicateCandidate[]>("/students/duplicates")
      .then((data) => (candidates.value = data))
      .catch(() => (candidates.value = []));
  }, [candidates]);

  useEffect(() => {
    load();
  }, [load]);

  async function merge(candidate: DuplicateCandidate) {
    merging.value = candidate.joinedId;
    try {
      await api(
        `/students/duplicates/${candidate.joinedId}/merge/${candidate.existingId}`,
        { method: "POST", body: {} },
      );
      toast.success(`${candidate.name} merged into their existing record`);
      candidates.value = candidates.value.filter(
        (c) => c.joinedId !== candidate.joinedId,
      );
      onMergedAction?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to merge records",
      );
    } finally {
      merging.value = null;
    }
  }

  if (candidates.value.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" />
          Possible duplicate{candidates.value.length === 1 ? "" : "s"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          These students joined with the school code, but the roster already had
          a record under their name. Merging keeps the existing record and its
          grades, and moves their login onto it.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.value.map((candidate) => (
          <div
            key={candidate.joinedId}
            className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
          >
            <span className="text-sm font-medium">{candidate.name}</span>
            {canMerge ? (
              <Button
                size="sm"
                variant="outline"
                disabled={merging.value === candidate.joinedId}
                onClick={() => merge(candidate)}
              >
                {merging.value === candidate.joinedId ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Merge className="mr-1.5 size-3.5" />
                )}
                Merge
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                An administrator can merge these
              </span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
