"use client";

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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  GripVertical,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { CourseModule, ModuleItem } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModuleItemRow, type ItemActions } from "./ModuleItemRow";

export function ModuleCard({
  module,
  base,
  canEdit,
  collapsed,
  otherModules,
  onToggleCollapsedAction,
  onPublishAction,
  onRenameAction,
  onDeleteAction,
  onAddItemAction,
  onReorderItemsAction,
  itemActionsAction,
}: {
  module: CourseModule;
  base: string;
  canEdit: boolean;
  collapsed: boolean;
  otherModules: Pick<CourseModule, "id" | "title">[];
  onToggleCollapsedAction: () => void;
  onPublishAction: (isPublished: boolean) => void;
  onRenameAction: () => void;
  onDeleteAction: () => void;
  onAddItemAction: () => void;
  onReorderItemsAction: (activeId: string, overId: string) => void;
  itemActionsAction: (item: ModuleItem) => ItemActions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: module.id, disabled: !canEdit });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorderItemsAction(String(active.id), String(over.id));
  }

  const items = [...module.items].sort((a, b) => a.position - b.position);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-20")}
    >
      <Card
        className={cn(
          "gap-0 py-0",
          isDragging && "shadow-lg",
          !module.isPublished && "border-dashed",
        )}
      >
        <div className="flex items-center gap-2 bg-muted/50 py-2.5 pr-3 pl-2">
          {canEdit && (
            <button
              type="button"
              aria-label="Drag to reorder module"
              className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCollapsedAction}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={!collapsed}
          >
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                collapsed && "-rotate-90",
              )}
            />
            <span className="truncate font-semibold">{module.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          </button>
          {canEdit ? (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  {module.isPublished ? "Published" : "Unpublished"}
                </span>
                <Switch
                  checked={module.isPublished}
                  onCheckedChange={onPublishAction}
                  aria-label="Module published"
                />
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add item"
                onClick={onAddItemAction}
              >
                <Plus className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Module options"
                    />
                  }
                >
                  <MoreVertical className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={onRenameAction}>
                    <Pencil className="mr-2 size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onAddItemAction}>
                    <Plus className="mr-2 size-4" />
                    Add item
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onDeleteAction}>
                    <Trash2 className="mr-2 size-4" />
                    Delete module
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            !module.isPublished && (
              <span className="text-xs text-muted-foreground">Unpublished</span>
            )
          )}
        </div>

        {!collapsed &&
          (items.length === 0 ? (
            <div className="border-t px-4 py-5 text-center text-sm text-muted-foreground">
              {canEdit ? (
                <button
                  type="button"
                  onClick={onAddItemAction}
                  className="text-primary hover:underline"
                >
                  Add the first item
                </button>
              ) : (
                "Nothing here yet."
              )}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={canEdit ? handleDragEnd : undefined}
            >
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((item) => (
                  <ModuleItemRow
                    key={item.id}
                    item={item}
                    base={base}
                    canEdit={canEdit}
                    otherModules={otherModules}
                    actions={itemActionsAction(item)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ))}
      </Card>
    </div>
  );
}
