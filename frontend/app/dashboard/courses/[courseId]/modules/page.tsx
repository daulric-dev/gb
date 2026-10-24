"use client";

import { useCallback, useEffect } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronsDownUp, ChevronsUpDown, Layers, Loader2, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CourseModule, ModuleItem } from "@/lib/courses/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCourse } from "../_components/course-context";
import { SectionHeader } from "../_components/SectionHeader";
import { ModuleCard } from "./_components/ModuleCard";
import { AddItemDialog } from "./_components/AddItemDialog";

/** The one text prompt used for new modules and renames. */
type TextPrompt =
  | { kind: "new-module" }
  | { kind: "rename-module"; module: CourseModule }
  | { kind: "rename-item"; item: ModuleItem };

export default function CourseModulesPage() {
  useSignals();
  const { course, base, canManage } = useCourse();

  const modules = useSignal<CourseModule[]>([]);
  const loading = useSignal(true);
  const collapsed = useSignal<Set<string>>(new Set());
  const prompt = useSignal<TextPrompt | null>(null);
  const promptValue = useSignal("");
  const saving = useSignal(false);
  const addingTo = useSignal<CourseModule | null>(null);
  const deleting = useSignal<CourseModule | null>(null);

  const url = `/courses/${course.id}/modules`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const load = useCallback(() => {
    api<CourseModule[]>(url)
      .then(
        (data) =>
          (modules.value = [...data].sort((a, b) => a.position - b.position)),
      )
      .catch(() => toast.error("Failed to load modules"))
      .finally(() => (loading.value = false));
  }, [url, modules, loading]);

  useEffect(() => {
    load();
  }, [load]);

  function fail(err: unknown, fallback: string) {
    toast.error(err instanceof ApiError ? err.message : fallback);
    load();
  }

  function openPrompt(p: TextPrompt) {
    promptValue.value =
      p.kind === "rename-module"
        ? p.module.title
        : p.kind === "rename-item"
          ? p.item.title
          : "";
    prompt.value = p;
  }

  async function submitPrompt(e: React.FormEvent) {
    e.preventDefault();
    const p = prompt.value;
    const title = promptValue.value.trim();
    if (!p || !title) return;
    saving.value = true;
    try {
      if (p.kind === "new-module") {
        await api(url, { method: "POST", body: { title } });
      } else if (p.kind === "rename-module") {
        await api(`${url}/${p.module.id}`, { method: "PATCH", body: { title } });
      } else {
        await api(`${url}/${p.item.moduleId}/items/${p.item.id}`, {
          method: "PATCH",
          body: { title },
        });
      }
      prompt.value = null;
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      saving.value = false;
    }
  }

  async function publishModule(m: CourseModule, isPublished: boolean) {
    modules.value = modules.value.map((x) =>
      x.id === m.id ? { ...x, isPublished } : x,
    );
    try {
      await api(`${url}/${m.id}`, { method: "PATCH", body: { isPublished } });
    } catch (err) {
      fail(err, "Failed to save");
    }
  }

  async function deleteModule() {
    const m = deleting.value;
    if (!m) return;
    try {
      await api(`${url}/${m.id}`, { method: "DELETE" });
      toast.success("Module deleted");
      deleting.value = null;
      load();
    } catch (err) {
      fail(err, "Failed to delete");
    }
  }

  async function handleModuleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = modules.value.map((m) => m.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(modules.value, from, to);
    modules.value = next;
    try {
      await api(`${url}/reorder`, {
        method: "PATCH",
        body: { moduleIds: next.map((m) => m.id) },
      });
    } catch (err) {
      fail(err, "Failed to reorder");
    }
  }

  async function reorderItems(m: CourseModule, activeId: string, overId: string) {
    const items = [...m.items].sort((a, b) => a.position - b.position);
    const from = items.findIndex((i) => i.id === activeId);
    const to = items.findIndex((i) => i.id === overId);
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to).map((i, position) => ({
      ...i,
      position,
    }));
    modules.value = modules.value.map((x) =>
      x.id === m.id ? { ...x, items: next } : x,
    );
    try {
      await api(`${url}/${m.id}/items/reorder`, {
        method: "PATCH",
        body: { itemIds: next.map((i) => i.id) },
      });
    } catch (err) {
      fail(err, "Failed to reorder");
    }
  }

  function itemActions(item: ModuleItem) {
    const itemUrl = `${url}/${item.moduleId}/items/${item.id}`;
    return {
      onPatch: async (patch: {
        title?: string;
        indent?: number;
        isPublished?: boolean;
        moduleId?: string;
      }) => {
        // Optimistic for the quick toggles; a move reloads to land it.
        if (patch.moduleId === undefined) {
          modules.value = modules.value.map((m) =>
            m.id === item.moduleId
              ? {
                  ...m,
                  items: m.items.map((i) =>
                    i.id === item.id ? { ...i, ...patch } : i,
                  ),
                }
              : m,
          );
        }
        try {
          await api(itemUrl, { method: "PATCH", body: patch });
          if (patch.moduleId !== undefined) {
            toast.success("Moved");
            load();
          }
        } catch (err) {
          fail(err, "Failed to save");
        }
      },
      onRename: () => openPrompt({ kind: "rename-item", item }),
      onRemove: async () => {
        modules.value = modules.value.map((m) =>
          m.id === item.moduleId
            ? { ...m, items: m.items.filter((i) => i.id !== item.id) }
            : m,
        );
        try {
          await api(itemUrl, { method: "DELETE" });
          toast.success("Removed from the module");
        } catch (err) {
          fail(err, "Failed to remove");
        }
      },
    };
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed.value = next;
  }

  const allCollapsed =
    modules.value.length > 0 &&
    modules.value.every((m) => collapsed.value.has(m.id));

  const promptTitle =
    prompt.value?.kind === "new-module"
      ? "New module"
      : prompt.value?.kind === "rename-module"
        ? "Rename module"
        : "Rename item";

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Modules"
        description="The course, week by week or unit by unit"
        actions={
          <>
            {modules.value.length > 1 && (
              <Button
                variant="outline"
                onClick={() =>
                  (collapsed.value = allCollapsed
                    ? new Set()
                    : new Set(modules.value.map((m) => m.id)))
                }
              >
                {allCollapsed ? (
                  <ChevronsUpDown className="mr-2 size-4" />
                ) : (
                  <ChevronsDownUp className="mr-2 size-4" />
                )}
                {allCollapsed ? "Expand all" : "Collapse all"}
              </Button>
            )}
            {canManage && (
              <Button onClick={() => openPrompt({ kind: "new-module" })}>
                <Plus className="mr-2 size-4" />
                Module
              </Button>
            )}
          </>
        }
      />

      {loading.value ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : modules.value.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Layers />
            </EmptyMedia>
            <EmptyTitle>No modules yet</EmptyTitle>
            <EmptyDescription>
              {canManage
                ? "Modules organise pages, assignments, files and links into the order students work through them."
                : "The teacher has not added any modules yet."}
            </EmptyDescription>
          </EmptyHeader>
          {canManage && (
            <EmptyContent>
              <Button onClick={() => openPrompt({ kind: "new-module" })}>
                <Plus className="mr-2 size-4" />
                Create the first module
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={canManage ? handleModuleDragEnd : undefined}
        >
          <SortableContext
            items={modules.value.map((m) => m.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4 animate-fade-in-up-delay-1">
              {modules.value.map((m) => (
                <ModuleCard
                  key={m.id}
                  module={m}
                  base={base}
                  canEdit={canManage}
                  collapsed={collapsed.value.has(m.id)}
                  otherModules={modules.value
                    .filter((x) => x.id !== m.id)
                    .map((x) => ({ id: x.id, title: x.title }))}
                  onToggleCollapsedAction={() => toggleCollapsed(m.id)}
                  onPublishAction={(v) => void publishModule(m, v)}
                  onRenameAction={() =>
                    openPrompt({ kind: "rename-module", module: m })
                  }
                  onDeleteAction={() => (deleting.value = m)}
                  onAddItemAction={() => (addingTo.value = m)}
                  onReorderItemsAction={(a, o) => void reorderItems(m, a, o)}
                  itemActionsAction={itemActions}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog
        open={!!prompt.value}
        onOpenChange={(v) => {
          if (!v) prompt.value = null;
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitPrompt} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{promptTitle}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="promptTitle">Title</Label>
              <Input
                id="promptTitle"
                value={promptValue.value}
                onChange={(e) => (promptValue.value = e.target.value)}
                placeholder={
                  prompt.value?.kind === "new-module" ? "Week 1: Introduction" : ""
                }
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (prompt.value = null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving.value}>
                {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                {prompt.value?.kind === "new-module" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AddItemDialog
        open={!!addingTo.value}
        courseId={course.id}
        moduleId={addingTo.value?.id ?? null}
        moduleTitle={addingTo.value?.title ?? "module"}
        onOpenChangeAction={(v) => {
          if (!v) addingTo.value = null;
        }}
        onAddedAction={load}
      />

      <AlertDialog
        open={!!deleting.value}
        onOpenChange={(v) => {
          if (!v) deleting.value = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting.value?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The module and its item links are removed. The pages,
              assignments and files they point to are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteModule}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
