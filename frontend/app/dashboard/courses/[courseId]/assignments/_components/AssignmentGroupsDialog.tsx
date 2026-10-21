"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AssignmentGroup } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** "" means unweighted; otherwise a number 0-100. */
function parseWeight(raw: string): number | null | undefined {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return n;
}

function GroupRow({
  group,
  canEdit,
  onSaveAction,
  onRemoveAction,
}: {
  group: AssignmentGroup;
  canEdit: boolean;
  onSaveAction: (patch: { name?: string; weight?: number | null }) => void;
  onRemoveAction: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id, disabled: !canEdit });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      {canEdit && (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <Input
        key={`${group.id}-name-${group.name}`}
        defaultValue={group.name}
        disabled={!canEdit}
        aria-label="Group name"
        className="h-8 min-w-0 flex-1"
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== group.name) onSaveAction({ name });
          else e.target.value = group.name;
        }}
      />
      <Input
        key={`${group.id}-w-${group.weight}`}
        type="number"
        min={0}
        max={100}
        placeholder="-"
        defaultValue={group.weight ?? ""}
        disabled={!canEdit}
        aria-label="Weight"
        className="h-8 w-20"
        onBlur={(e) => {
          const weight = parseWeight(e.target.value);
          if (weight === undefined) {
            toast.error("Weight must be between 0 and 100");
            e.target.value = group.weight === null ? "" : String(group.weight);
            return;
          }
          if (weight !== group.weight) onSaveAction({ weight });
        }}
      />
      <span className="text-sm text-muted-foreground">%</span>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemoveAction}
          aria-label="Remove group"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}

/**
 * Assignment groups and their weights: Homework 20%, Quizzes 30%, Exams 50%.
 * Leave every weight blank and the course total is plain points earned over
 * points possible. Weights are not forced to 100: the gradebook renormalises
 * over groups that have marked work, so the running total is only a guide.
 */
export function AssignmentGroupsDialog({
  open,
  courseId,
  groups,
  canEdit,
  onOpenChangeAction,
  onChangedAction,
}: {
  open: boolean;
  courseId: string;
  groups: AssignmentGroup[];
  canEdit: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onChangedAction: () => void;
}) {
  useSignals();
  const newName = useSignal("");
  const newWeight = useSignal("");
  const working = useSignal(false);
  // Optimistic order while a drag is saved.
  const order = useSignal<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ordered = order.value
    ? order.value
        .map((id) => groups.find((g) => g.id === id))
        .filter((g): g is AssignmentGroup => !!g)
    : groups;

  async function add() {
    const name = newName.value.trim();
    const weight = parseWeight(newWeight.value);
    if (!name) {
      toast.error("Give the group a name");
      return;
    }
    if (weight === undefined) {
      toast.error("Weight must be between 0 and 100");
      return;
    }
    working.value = true;
    try {
      await api(`/courses/${courseId}/assignment-groups`, {
        method: "POST",
        body: { name, ...(weight !== null ? { weight } : {}) },
      });
      newName.value = "";
      newWeight.value = "";
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add group");
    } finally {
      working.value = false;
    }
  }

  async function save(id: string, patch: { name?: string; weight?: number | null }) {
    try {
      await api(`/courses/${courseId}/assignment-groups/${id}`, {
        method: "PATCH",
        body: patch,
      });
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
      onChangedAction();
    }
  }

  async function remove(group: AssignmentGroup) {
    if (
      !confirm(
        `Remove "${group.name}"? Its assignments stay, but become ungrouped.`,
      )
    )
      return;
    try {
      await api(`/courses/${courseId}/assignment-groups/${group.id}`, {
        method: "DELETE",
      });
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((g) => g.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    order.value = next;
    try {
      await api(`/courses/${courseId}/assignment-groups/reorder`, {
        method: "PATCH",
        body: { groupIds: next },
      });
      onChangedAction();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to reorder");
    } finally {
      order.value = null;
    }
  }

  const weighted = groups.filter((g) => g.weight !== null);
  const total = weighted.reduce((sum, g) => sum + (g.weight ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assignment groups</DialogTitle>
          <DialogDescription>
            Work is averaged inside each group, then groups are weighted
            against each other. Leave every weight blank to grade on total
            points instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {groups.length === 0 ? (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              No groups yet. Everything counts by points.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={canEdit ? handleDragEnd : undefined}
            >
              <SortableContext
                items={ordered.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {ordered.map((g) => (
                    <GroupRow
                      key={g.id}
                      group={g}
                      canEdit={canEdit}
                      onSaveAction={(patch) => void save(g.id, patch)}
                      onRemoveAction={() => void remove(g)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {weighted.length > 0 && (
            <div className="flex items-center justify-between px-1 pt-1 text-sm">
              <span className="text-muted-foreground">Total weight</span>
              <span
                className={cn(
                  "font-medium",
                  total !== 100 && "text-amber-600 dark:text-amber-500",
                )}
              >
                {total}%
                {total !== 100 && (
                  <span className="ml-2 text-xs font-normal">
                    grades are scaled to this total
                  </span>
                )}
              </span>
            </div>
          )}

          {canEdit && (
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="newGroupName" className="text-xs">
                  New group
                </Label>
                <Input
                  id="newGroupName"
                  placeholder="Homework"
                  value={newName.value}
                  onChange={(e) => (newName.value = e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void add();
                  }}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label htmlFor="newGroupWeight" className="text-xs">
                  Weight %
                </Label>
                <Input
                  id="newGroupWeight"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="-"
                  value={newWeight.value}
                  onChange={(e) => (newWeight.value = e.target.value)}
                />
              </div>
              <Button onClick={add} disabled={working.value} aria-label="Add group">
                {working.value ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChangeAction(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
