"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Folder,
  FolderPlus,
  ChevronRight,
  MoreVertical,
  Pencil,
  Trash2,
  Lock,
  GripVertical,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileItem, FolderContents, FolderItem } from "./types";
import { FilesTable } from "./FilesTable";
import { UploadButton } from "./UploadButton";
import {
  NewFolderDialog,
  RenameFolderDialog,
  MoveFileDialog,
} from "./FolderDialogs";

type DragInfo = { kind: "file" | "folder"; name: string };

export function FolderBrowser({
  currentUserId,
  canCreate,
  reloadKey,
  onView,
  onShare,
  onRename,
  onDelete,
}: {
  currentUserId: string | undefined;
  canCreate: boolean;
  /** Bumped by the page after a file rename/delete so the browser refetches. */
  reloadKey: number;
  onView: (file: FileItem) => void;
  onShare: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
}) {
  useSignals();
  const folderId = useSignal<string | null>(null);
  const contents = useSignal<FolderContents | null>(null);
  const loading = useSignal(true);

  const newFolderOpen = useSignal(false);
  const renameFolder = useSignal<FolderItem | null>(null);
  const deleteFolder = useSignal<FolderItem | null>(null);
  const moveFile = useSignal<FileItem | null>(null);
  const dragging = useSignal<DragInfo | null>(null);

  // A small drag threshold so clicking a folder/handle still registers as a
  // click, not a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function load(id: string | null) {
    loading.value = true;
    const q = id ? `?folderId=${id}` : "";
    api<FolderContents>(`/files/folders/contents${q}`)
      .then((data) => (contents.value = data))
      .catch(() => toast.error("Failed to load folder"))
      .finally(() => (loading.value = false));
  }

  useEffect(() => {
    load(folderId.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId.value, reloadKey]);

  function open(id: string | null) {
    folderId.value = id;
  }

  async function moveFileTo(fileId: string, targetId: string | null) {
    try {
      await api(`/files/${fileId}/move`, {
        method: "PATCH",
        body: { folderId: targetId },
      });
      toast.success("Moved");
      load(folderId.value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move file");
    }
  }

  async function moveFolderTo(id: string, targetId: string | null) {
    try {
      await api(`/files/folders/${id}/move`, {
        method: "PATCH",
        body: { parentId: targetId },
      });
      toast.success("Moved");
      load(folderId.value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move folder");
    }
  }

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as
      | { kind: "file" | "folder"; name: string }
      | undefined;
    dragging.value = d ? { kind: d.kind, name: d.name } : null;
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.value = null;
    const over = e.over;
    if (!over) return;
    const overId = String(over.id);
    // Drop targets are "drop:root" or "drop:<folderId>".
    if (!overId.startsWith("drop:")) return;
    const targetId = overId === "drop:root" ? null : overId.slice(5);

    const d = e.active.data.current as
      | { kind: "file" | "folder"; id: string; folderId?: string | null; parentId?: string | null }
      | undefined;
    if (!d) return;

    if (d.kind === "file") {
      if ((d.folderId ?? null) === targetId) return; // already there
      void moveFileTo(d.id, targetId);
    } else {
      if (d.id === targetId) return; // into itself
      if ((d.parentId ?? null) === targetId) return; // already there
      void moveFolderTo(d.id, targetId);
    }
  }

  async function confirmDeleteFolder() {
    const folder = deleteFolder.value;
    if (!folder) return;
    try {
      await api(`/files/folders/${folder.id}`, { method: "DELETE" });
      toast.success("Folder deleted");
      load(folderId.value);
    } catch {
      toast.error("Failed to delete folder");
    } finally {
      deleteFolder.value = null;
    }
  }

  const data = contents.value;
  const crumbs = data?.breadcrumb ?? [];

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => (dragging.value = null)}
    >
      <div className="space-y-4">
        {/* Breadcrumb + toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex items-center gap-1 text-sm">
            <Crumb id="drop:root" label="My files" bold onClick={() => open(null)} />
            {crumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <Crumb
                  id={`drop:${c.id}`}
                  label={c.name}
                  onClick={() => open(c.id)}
                />
              </span>
            ))}
          </nav>

          {canCreate && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => (newFolderOpen.value = true)}
              >
                <FolderPlus className="size-4" />
                New folder
              </Button>
              <UploadButton
                folderId={folderId.value}
                onUploaded={() => load(folderId.value)}
              />
            </div>
          )}
        </div>

        {loading.value ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* Subfolders */}
            {data && data.folders.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {data.folders.map((folder) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    onOpen={() => open(folder.id)}
                    onRename={() => (renameFolder.value = folder)}
                    onDelete={() => (deleteFolder.value = folder)}
                  />
                ))}
              </div>
            )}

            {/* Files in this folder */}
            {data && data.files.length > 0 ? (
              <FilesTable
                files={data.files}
                currentUserId={currentUserId}
                dnd
                onView={onView}
                onShare={onShare}
                onRename={onRename}
                onDelete={onDelete}
                onMove={(f) => (moveFile.value = f)}
              />
            ) : (
              data &&
              data.folders.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                  <Folder className="mb-2 size-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">This folder is empty</p>
                  <p className="mt-1 text-xs">
                    Upload a file, create a subfolder, or drag items here.
                  </p>
                </div>
              )
            )}
          </>
        )}

        <NewFolderDialog
          open={newFolderOpen.value}
          parentId={folderId.value}
          onOpenChange={(o) => (newFolderOpen.value = o)}
          onCreated={() => load(folderId.value)}
        />
        <RenameFolderDialog
          folder={renameFolder.value}
          onClose={() => (renameFolder.value = null)}
          onRenamed={() => load(folderId.value)}
        />
        <MoveFileDialog
          file={moveFile.value}
          onClose={() => (moveFile.value = null)}
          onMoved={() => load(folderId.value)}
        />

        <AlertDialog
          open={deleteFolder.value !== null}
          onOpenChange={(o) => {
            if (!o) deleteFolder.value = null;
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
              <AlertDialogDescription>
                “{deleteFolder.value?.name}” and everything inside it — including
                any subfolders and their files — will be deleted. This can’t be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteFolder}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* What the cursor carries while dragging. */}
      <DragOverlay dropAnimation={null}>
        {dragging.value ? (
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg">
            {dragging.value.kind === "folder" ? (
              <Folder className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
            <span className="max-w-48 truncate">{dragging.value.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** A folder tile: a drop target for files/folders, and itself draggable. */
function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: FolderItem;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${folder.id}`,
  });
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
  } = useDraggable({
    id: `folder:${folder.id}`,
    // System folders (e.g. Reports) stay put so auto-filing keeps working.
    disabled: folder.isSystem,
    data: {
      kind: "folder",
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
    },
  });

  return (
    <div
      ref={setDropRef}
      className={cn(
        "group flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/50",
        isOver && "ring-2 ring-primary bg-accent",
      )}
    >
      {!folder.isSystem && (
        <button
          ref={setDragRef}
          type="button"
          aria-label="Drag folder"
          className="cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onOpen}
      >
        <Folder className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{folder.name}</span>
        {folder.isSystem && (
          <Lock className="size-3 shrink-0 text-muted-foreground/60" />
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 opacity-60 group-hover:opacity-100"
              aria-label="Folder actions"
            />
          }
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={folder.isSystem} onClick={onRename}>
            <Pencil className="mr-2 size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="mr-2 size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A breadcrumb entry that is also a drop target (move up / to root). */
function Crumb({
  id,
  label,
  bold,
  onClick,
}: {
  id: string;
  label: string;
  bold?: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 hover:bg-accent",
        bold && "font-medium",
        isOver && "ring-2 ring-primary bg-accent",
      )}
    >
      {label}
    </button>
  );
}
