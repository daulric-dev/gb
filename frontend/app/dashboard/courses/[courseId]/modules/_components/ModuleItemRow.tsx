"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExternalLink,
  FileText,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Link2,
  Loader2,
  MessagesSquare,
  MoreVertical,
  Paperclip,
  Pencil,
  Trash2,
} from "lucide-react";
import type { CourseModule, ModuleItem } from "@/lib/courses/types";
import { formatDue } from "@/lib/courses/format";
import { fetchStaffCourseFileBlob } from "@/lib/files/content";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACTIVITY_ICON } from "../../assignments/_components/ActivityStatusBadge";

const MAX_INDENT = 3;

function ItemIcon({
  item,
  className,
}: {
  item: ModuleItem;
  className?: string;
}) {
  if (item.itemType === "activity" && item.activity) {
    const Kind = ACTIVITY_ICON[item.activity.kind];
    return <Kind className={className} />;
  }
  if (item.itemType === "file") return <Paperclip className={className} />;
  if (item.itemType === "link") return <Link2 className={className} />;
  if (item.itemType === "discussion") {
    return <MessagesSquare className={className} />;
  }
  return <FileText className={className} />;
}

function itemHref(item: ModuleItem, base: string): string | null {
  switch (item.itemType) {
    case "page":
      return item.pageId ? `${base}/pages/${item.pageId}` : null;
    case "activity":
      return item.activityId ? `${base}/assignments/${item.activityId}` : null;
    case "link":
      return item.url;
    case "discussion":
      return item.discussionTopicId
        ? `${base}/discussions/${item.discussionTopicId}`
        : null;
    default:
      return null;
  }
}

export interface ItemActions {
  onPatch: (patch: {
    title?: string;
    indent?: number;
    isPublished?: boolean;
    moduleId?: string;
  }) => void;
  onRename: () => void;
  onRemove: () => void;
}

export function ModuleItemRow({
  item,
  courseId,
  base,
  canEdit,
  otherModules,
  actions,
}: {
  item: ModuleItem;
  courseId: string;
  base: string;
  canEdit: boolean;
  otherModules: Pick<CourseModule, "id" | "title">[];
  actions: ItemActions;
}) {
  useSignals();
  const opening = useSignal(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: !canEdit });

  const isHeader = item.itemType === "header";
  const href = itemHref(item, base);
  const external = item.itemType === "link";

  // Files open through the course, so a colleague's linked file opens too.
  async function openFile(fileId: string) {
    // Open the tab synchronously so popup blockers allow it, then point it
    // at the file once the bytes arrive.
    const win = window.open("", "_blank");
    opening.value = true;
    try {
      const blob = await fetchStaffCourseFileBlob(courseId, fileId);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      win?.close();
      toast.error("This file could not be opened. It may have been deleted.");
    } finally {
      opening.value = false;
    }
  }

  const titleNode = isHeader ? (
    <span className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {item.title}
    </span>
  ) : item.itemType === "file" && item.fileId ? (
    <button
      type="button"
      onClick={() => openFile(item.fileId!)}
      disabled={opening.value}
      className="flex items-center truncate text-left text-sm font-medium hover:underline disabled:opacity-70"
    >
      {item.title}
      {opening.value && (
        <Loader2 className="ml-1.5 size-3 shrink-0 animate-spin text-muted-foreground" />
      )}
    </button>
  ) : href ? (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="truncate text-sm font-medium hover:underline"
    >
      {item.title}
      {external && (
        <ExternalLink className="ml-1 inline size-3 text-muted-foreground" />
      )}
    </Link>
  ) : (
    <span className="truncate text-sm font-medium">{item.title}</span>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 border-t bg-card py-2 pr-3 pl-2 transition-colors hover:bg-muted/40",
        isDragging && "relative z-10 shadow-md",
        isHeader && "bg-muted/20",
      )}
    >
      {canEdit ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-2" />
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-2.5"
        style={{ paddingLeft: `${item.indent * 1.5}rem` }}
      >
        {!isHeader && (
          <ItemIcon
            item={item}
            className={cn(
              "size-4 shrink-0",
              item.isPublished ? "text-primary" : "text-muted-foreground",
            )}
          />
        )}
        <div className="flex min-w-0 flex-col">
          {titleNode}
          {item.activity && (
            <span className="text-xs text-muted-foreground">
              {formatDue(item.activity.dueAt)} · {item.activity.points} pts
              {item.activity.status === "draft" && " · draft"}
            </span>
          )}
        </div>
      </div>

      {canEdit ? (
        <>
          <Switch
            size="sm"
            checked={item.isPublished}
            onCheckedChange={(v) => actions.onPatch({ isPublished: v })}
            aria-label={item.isPublished ? "Unpublish item" : "Publish item"}
            title={item.isPublished ? "Published" : "Unpublished"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Item options" />
              }
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={actions.onRename}>
                <Pencil className="mr-2 size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={item.indent >= MAX_INDENT}
                onClick={() => actions.onPatch({ indent: item.indent + 1 })}
              >
                <IndentIncrease className="mr-2 size-4" />
                Indent
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={item.indent <= 0}
                onClick={() => actions.onPatch({ indent: item.indent - 1 })}
              >
                <IndentDecrease className="mr-2 size-4" />
                Outdent
              </DropdownMenuItem>
              {otherModules.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to...</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {otherModules.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => actions.onPatch({ moduleId: m.id })}
                      >
                        {m.title}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={actions.onRemove}>
                <Trash2 className="mr-2 size-4" />
                Remove from module
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : (
        !item.isPublished && (
          <span className="text-xs text-muted-foreground">Unpublished</span>
        )
      )}
    </div>
  );
}
