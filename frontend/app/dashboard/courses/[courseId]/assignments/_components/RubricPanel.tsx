"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Copy, Loader2, Pencil, Plus, Sparkles, Table2, Unlink } from "lucide-react";
import { api } from "@/lib/api";
import type { ActivityRubric, Rubric } from "@/lib/courses/types";
import { RubricGrid } from "@/components/rubric/RubricGrid";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { RubricEditorDialog } from "./RubricEditorDialog";
import { userMessage } from "@/lib/errors";
import { aiCourseApi, aiErrorMessage, type RubricDraft } from "@/lib/ai";

/**
 * The activity's rubric: what is attached, and (for the teacher) picking one
 * of the course's rubrics, building a new one, or detaching. Marking with it
 * happens in the marks table.
 */
export function RubricPanel({
  courseId,
  activityId,
  points,
  rubric,
  canManage,
  onChangedAction,
  ai = null,
}: {
  courseId: string;
  activityId: string;
  points: number;
  rubric: Rubric | null;
  canManage: boolean;
  onChangedAction: () => void;
  /** AI assistance on: "Draft a rubric with AI" from the activity's title and instructions. */
  ai?: { title: string; instructions: string | null } | null;
}) {
  useSignals();
  const rubrics = useSignal<Rubric[]>([]);
  const editing = useSignal<Rubric | null | "new">(null);
  const working = useSignal(false);
  const drafting = useSignal(false);
  const aiDraft = useSignal<RubricDraft["rubric"] | null>(null);

  async function draftWithAi() {
    if (!ai) return;
    drafting.value = true;
    try {
      const out = await aiCourseApi.rubric(courseId, {
        title: ai.title,
        ...(ai.instructions?.trim() ? { instructions: ai.instructions } : {}),
        ...(points >= 1 ? { totalPoints: points } : {}),
      });
      if (out.dropped) toast.message(`${out.dropped} criterion draft${out.dropped === 1 ? " was" : "s were"} left out (levels worth more than the criterion).`);
      aiDraft.value = out.rubric;
      editing.value = "new";
    } catch (err) {
      toast.error(aiErrorMessage(err));
    } finally {
      drafting.value = false;
    }
  }

  function loadRubrics() {
    api<Rubric[]>(`/courses/${courseId}/rubrics`)
      .then((data) => (rubrics.value = data))
      .catch(() => (rubrics.value = []));
  }

  useEffect(() => {
    if (canManage) loadRubrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, canManage]);

  async function attach(rubricId: string | null) {
    working.value = true;
    try {
      await api<ActivityRubric>(`/activities/${activityId}/rubric`, {
        method: "PUT",
        body: { rubricId },
      });
      toast.success(rubricId ? "Rubric attached" : "Rubric detached");
      onChangedAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      working.value = false;
    }
  }

  async function copy(source: Rubric) {
    working.value = true;
    try {
      const made = await api<Rubric>(
        `/courses/${courseId}/rubrics/${source.id}/copy`,
        { method: "POST", body: {} },
      );
      loadRubrics();
      editing.value = made;
    } catch (err) {
      toast.error(userMessage(err, "Failed to copy"));
    } finally {
      working.value = false;
    }
  }

  const items = rubrics.value.map((r) => ({
    value: r.id,
    label: `${r.title} (${r.pointsPossible} pts)`,
  }));

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <Select
              value={rubric?.id ?? null}
              onValueChange={(v) => {
                if (v && v !== rubric?.id) void attach(v as string);
              }}
              items={items}
            >
              <SelectTrigger className="w-72" disabled={working.value}>
                <SelectValue placeholder="Use a course rubric" />
              </SelectTrigger>
              <SelectContent>
                {items.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={() => {
              aiDraft.value = null;
              editing.value = "new";
            }}
          >
            <Plus className="mr-1.5 size-4" />
            New rubric
          </Button>
          {ai && (
            <Button variant="outline" onClick={() => void draftWithAi()} disabled={drafting.value}>
              {drafting.value ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="mr-1.5 size-4" aria-hidden />
              )}
              {drafting.value ? "Drafting…" : "Draft a rubric with AI"}
            </Button>
          )}
          {rubric && (
            <>
              {rubric.assessed ? (
                <Button
                  variant="ghost"
                  onClick={() => void copy(rubric)}
                  disabled={working.value}
                  title="Used for marking: copy it to change the criteria"
                >
                  <Copy className="mr-1.5 size-4" />
                  Copy to edit
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => (editing.value = rubric)}>
                  <Pencil className="mr-1.5 size-4" />
                  Edit
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => void attach(null)}
                disabled={working.value}
              >
                <Unlink className="mr-1.5 size-4" />
                Detach
              </Button>
            </>
          )}
        </div>
      )}

      {rubric ? (
        <>
          {rubric.pointsPossible !== points && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
              This rubric is worth {rubric.pointsPossible} points but the work
              is out of {points}. Marks are the rubric&apos;s total, so give a
              score yourself when they differ.
            </p>
          )}
          <p className="text-sm font-medium">{rubric.title}</p>
          <RubricGrid rubric={rubric} />
        </>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Table2 />
            </EmptyMedia>
            <EmptyTitle>No rubric</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Attach one of the course's rubrics, or build a new one, to mark criterion by criterion."
                : "The teacher has not attached a rubric."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <RubricEditorDialog
        open={editing.value !== null}
        courseId={courseId}
        rubric={editing.value === "new" ? null : editing.value}
        aiDraft={editing.value === "new" ? aiDraft.value : null}
        onOpenChangeAction={(open) => {
          if (!open) {
            editing.value = null;
            aiDraft.value = null;
          }
        }}
        onSavedAction={(saved) => {
          loadRubrics();
          // A new rubric (or a copy) goes straight onto this activity.
          if (saved.id !== rubric?.id) void attach(saved.id);
          else onChangedAction();
        }}
      />
    </div>
  );
}
