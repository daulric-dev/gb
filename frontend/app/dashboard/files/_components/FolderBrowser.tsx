"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
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
} from "lucide-react";
import type { FileItem, FolderContents, FolderItem } from "./types";
import { FilesTable } from "./FilesTable";
import { UploadButton } from "./UploadButton";
import {
  NewFolderDialog,
  RenameFolderDialog,
  MoveFileDialog,
} from "./FolderDialogs";

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
    <div className="space-y-4">
      {/* Breadcrumb + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex items-center gap-1 text-sm">
          <button
            className="rounded px-1.5 py-0.5 font-medium hover:bg-accent"
            onClick={() => open(null)}
          >
            My files
          </button>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <button
                className="rounded px-1.5 py-0.5 hover:bg-accent"
                onClick={() => open(c.id)}
              >
                {c.name}
              </button>
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
                <div
                  key={folder.id}
                  className="group flex items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => open(folder.id)}
                  >
                    <Folder className="size-5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">
                      {folder.name}
                    </span>
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
                      <DropdownMenuItem
                        disabled={folder.isSystem}
                        onClick={() => (renameFolder.value = folder)}
                      >
                        <Pencil className="mr-2 size-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => (deleteFolder.value = folder)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}

          {/* Files in this folder */}
          {data && data.files.length > 0 ? (
            <FilesTable
              files={data.files}
              currentUserId={currentUserId}
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
                  Upload a file or create a subfolder.
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
  );
}
