"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
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
import { FolderOpen } from "lucide-react";
import type { FileItem } from "./_components/types";
import { UploadButton } from "./_components/UploadButton";
import { FilesTable } from "./_components/FilesTable";
import { FileViewerDialog } from "./_components/FileViewerDialog";
import { ShareDialog } from "./_components/ShareDialog";
import { RenameDialog } from "./_components/RenameDialog";

type Filter = "all" | "own" | "shared";

export default function FilesPage() {
  useSignals();
  const { profile } = useProfile();
  const { can } = usePermissions();

  const files = useSignal<FileItem[]>([]);
  const loading = useSignal(true);
  const filter = useSignal<Filter>("all");

  const viewFile = useSignal<FileItem | null>(null);
  const shareFile = useSignal<FileItem | null>(null);
  const renameFile = useSignal<FileItem | null>(null);
  const deleteFile = useSignal<FileItem | null>(null);

  const fetchFiles = useCallback((f: Filter) => {
    loading.value = true;
    api<FileItem[]>(`/files?filter=${f}`)
      .then((data) => (files.value = data))
      .catch(() => toast.error("Failed to load files"))
      .finally(() => (loading.value = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchFiles(filter.value);
  }, [filter.value, fetchFiles]);

  async function confirmDelete() {
    const file = deleteFile.value;
    if (!file) return;
    try {
      await api(`/files/${file.id}`, { method: "DELETE" });
      toast.success("File deleted");
      fetchFiles(filter.value);
    } catch {
      toast.error("Failed to delete");
    } finally {
      deleteFile.value = null;
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Files"
        description="Your reports and uploads, and files shared with you"
        action={
          can("file", "create") ? (
            <UploadButton onUploaded={() => fetchFiles(filter.value)} />
          ) : undefined
        }
      />

      <Tabs
        value={filter.value}
        onValueChange={(v) => (filter.value = v as Filter)}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="own">My files</TabsTrigger>
          <TabsTrigger value="shared">Shared with me</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : files.value.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FolderOpen className="mb-3 size-10 text-muted-foreground/40" />
          <p className="font-medium">No files here yet</p>
          <p className="mt-1 text-sm">
            Generated reports show up automatically, or upload a file.
          </p>
        </div>
      ) : (
        <FilesTable
          files={files.value}
          currentUserId={profile.value?.id}
          onView={(f) => (viewFile.value = f)}
          onShare={(f) => (shareFile.value = f)}
          onRename={(f) => (renameFile.value = f)}
          onDelete={(f) => (deleteFile.value = f)}
        />
      )}

      <FileViewerDialog
        file={viewFile.value}
        onClose={() => (viewFile.value = null)}
      />
      <ShareDialog
        file={shareFile.value}
        onClose={() => (shareFile.value = null)}
      />
      <RenameDialog
        file={renameFile.value}
        onClose={() => (renameFile.value = null)}
        onRenamed={() => fetchFiles(filter.value)}
      />

      <AlertDialog
        open={deleteFile.value !== null}
        onOpenChange={(open) => {
          if (!open) deleteFile.value = null;
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteFile.value?.name}” will be removed and anyone it was shared
              with will lose access. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
