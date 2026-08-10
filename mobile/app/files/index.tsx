import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { ChevronRight, FolderClosed, FolderPlus, Upload } from "lucide-react-native";
import { api, apiUpload, ApiError } from "@/lib/api";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useAuth } from "@/providers/AuthProvider";
import { Screen } from "@/components/layout/Screen";
import { Tabs } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FileRow } from "@/features/files/FileRow";
import { FolderRow } from "@/features/files/FolderRow";
import { NameSheet } from "@/features/files/NameSheet";
import { ShareSheet } from "@/features/files/ShareSheet";
import { FileDetailsSheet } from "@/features/files/FileDetailsSheet";
import type {
  FileItem,
  Filter,
  FolderContents,
  FolderItem,
} from "@/features/files/types";

const MAX_SIZE = 10 * 1024 * 1024;

const TABS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "own", label: "My files" },
  { value: "shared", label: "Shared with me" },
];

function ListSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} style={{ height: 72, borderRadius: 14 }} />
      ))}
    </View>
  );
}

export default function FilesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const { can } = usePermissions();
  const { profile } = useAuth();
  const currentUserId = profile?.id;
  const canCreate = can("file", "create");

  const [tab, setTab] = useState<Filter>("all");
  const [folderId, setFolderId] = useState<string | null>(null);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Dialog / sheet targets.
  const [detailsFile, setDetailsFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileItem | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameFolder, setRenameFolder] = useState<FolderItem | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<FolderItem | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchList = useCallback(
    async (f: Filter) => {
      try {
        const data = await api<FileItem[]>(`/files?filter=${f}`);
        setFiles(data);
      } catch {
        toast.error("Failed to load files");
      }
    },
    [toast],
  );

  const fetchContents = useCallback(
    async (id: string | null) => {
      try {
        const q = id ? `?folderId=${id}` : "";
        const data = await api<FolderContents>(`/files/folders/contents${q}`);
        setContents(data);
      } catch {
        toast.error("Failed to load folder");
      }
    },
    [toast],
  );

  // Load whenever the tab, folder, or reload key changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const task = tab === "own" ? fetchContents(folderId) : fetchList(tab);
    task.finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, folderId, reloadKey, fetchContents, fetchList]);

  // Opening Files acknowledges any share notifications (fire-and-forget).
  useEffect(() => {
    api("/files/notifications/mark-read", { method: "POST" }).catch(() => {});
  }, []);

  const reload = () => setReloadKey((k) => k + 1);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const task = tab === "own" ? fetchContents(folderId) : fetchList(tab);
    task.finally(() => setRefreshing(false));
  }, [tab, folderId, fetchContents, fetchList]);

  const onTabChange = (v: Filter) => {
    setTab(v);
    setFolderId(null);
  };

  const handleUpload = async () => {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({});
    } catch {
      toast.error("Could not open the file picker");
      return;
    }
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if (asset.size && asset.size > MAX_SIZE) {
      toast.error("File must be under 10MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/octet-stream",
      } as unknown as Blob);
      let query = `?name=${encodeURIComponent(asset.name)}`;
      if (tab === "own" && folderId) {
        query += `&folderId=${encodeURIComponent(folderId)}`;
      }
      await apiUpload(`/files${query}`, formData);
      toast.success("File uploaded — it will be available once scanned");
      reload();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submitRenameFile = async (name: string) => {
    if (!renameFile) return;
    try {
      await api(`/files/${renameFile.id}`, { method: "PATCH", body: { name } });
      toast.success("File renamed");
      setRenameFile(null);
      reload();
    } catch {
      toast.error("Failed to rename");
    }
  };

  const submitNewFolder = async (name: string) => {
    try {
      await api("/files/folders", {
        method: "POST",
        body: { name, parentId: folderId ?? undefined },
      });
      toast.success("Folder created");
      setNewFolderOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create folder");
    }
  };

  const submitRenameFolder = async (name: string) => {
    if (!renameFolder) return;
    try {
      await api(`/files/folders/${renameFolder.id}`, {
        method: "PATCH",
        body: { name },
      });
      toast.success("Folder renamed");
      setRenameFolder(null);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to rename folder");
    }
  };

  const confirmDeleteFile = async () => {
    if (!deleteFile) return;
    setBusy(true);
    try {
      await api(`/files/${deleteFile.id}`, { method: "DELETE" });
      toast.success("File deleted");
      setDeleteFile(null);
      reload();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolder) return;
    setBusy(true);
    try {
      await api(`/files/folders/${deleteFolder.id}`, { method: "DELETE" });
      toast.success("Folder deleted");
      setDeleteFolder(null);
      reload();
    } catch {
      toast.error("Failed to delete folder");
    } finally {
      setBusy(false);
    }
  };

  const renderFileRow = (file: FileItem) => (
    <FileRow
      key={file.id}
      file={file}
      isOwner={file.ownerId === currentUserId}
      onPress={() => setDetailsFile(file)}
      onShare={() => setShareFile(file)}
      onRename={() => setRenameFile(file)}
      onDelete={() => setDeleteFile(file)}
    />
  );

  const crumbs = contents?.breadcrumb ?? [];

  const uploadAction =
    canCreate && tab !== "own" ? (
      <Button
        size="sm"
        onPress={handleUpload}
        loading={uploading}
        icon={<Upload size={16} color={colors.primaryForeground} />}
      >
        Upload
      </Button>
    ) : undefined;

  return (
    <Screen
      title="Files"
      description="Your reports and uploads, and files shared with you"
      onBack={() => router.back()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      action={uploadAction}
    >
      <Tabs tabs={TABS} value={tab} onChange={onTabChange} />

      {tab === "own" ? (
        <View style={{ gap: 16 }}>
          {/* Breadcrumb */}
          <View style={styles.breadcrumb}>
            <Pressable onPress={() => setFolderId(null)} hitSlop={6}>
              <Text weight={folderId ? "500" : "600"}>My files</Text>
            </Pressable>
            {crumbs.map((c) => (
              <View key={c.id} style={styles.crumb}>
                <ChevronRight size={14} color={colors.mutedForeground} />
                <Pressable onPress={() => setFolderId(c.id)} hitSlop={6}>
                  <Text weight={c.id === folderId ? "600" : "500"}>
                    {c.name}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>

          {/* Toolbar */}
          {canCreate ? (
            <View style={styles.toolbar}>
              <Button
                variant="outline"
                size="sm"
                onPress={() => setNewFolderOpen(true)}
                icon={<FolderPlus size={16} color={colors.foreground} />}
              >
                New folder
              </Button>
              <Button
                size="sm"
                onPress={handleUpload}
                loading={uploading}
                icon={<Upload size={16} color={colors.primaryForeground} />}
              >
                Upload
              </Button>
            </View>
          ) : null}

          {loading ? (
            <ListSkeleton />
          ) : contents &&
            contents.folders.length === 0 &&
            contents.files.length === 0 ? (
            <EmptyState
              icon={FolderClosed}
              title="This folder is empty"
              description={
                canCreate
                  ? "Upload a file or create a subfolder to get started."
                  : "Nothing here yet."
              }
            />
          ) : (
            <View style={{ gap: 12 }}>
              {contents?.folders.map((folder) => (
                <FolderRow
                  key={folder.id}
                  folder={folder}
                  canManage={canCreate}
                  onOpen={() => setFolderId(folder.id)}
                  onRename={() => setRenameFolder(folder)}
                  onDelete={() => setDeleteFolder(folder)}
                />
              ))}
              {contents?.files.map(renderFileRow)}
            </View>
          )}
        </View>
      ) : loading ? (
        <ListSkeleton />
      ) : files.length === 0 ? (
        <EmptyState
          icon={FolderClosed}
          title="No files here yet"
          description="Generated reports show up automatically, or upload a file."
        />
      ) : (
        <View style={{ gap: 12 }}>{files.map(renderFileRow)}</View>
      )}

      <FileDetailsSheet
        file={detailsFile}
        onClose={() => setDetailsFile(null)}
      />
      <ShareSheet file={shareFile} onClose={() => setShareFile(null)} />

      <NameSheet
        open={renameFile !== null}
        title="Rename file"
        initialValue={renameFile?.name ?? ""}
        onClose={() => setRenameFile(null)}
        onSubmit={submitRenameFile}
      />
      <NameSheet
        open={newFolderOpen}
        title="New folder"
        description="Organize your files. Only you can see your folders."
        label="Folder name"
        submitLabel="Create"
        placeholder="Folder name"
        onClose={() => setNewFolderOpen(false)}
        onSubmit={submitNewFolder}
      />
      <NameSheet
        open={renameFolder !== null}
        title="Rename folder"
        initialValue={renameFolder?.name ?? ""}
        onClose={() => setRenameFolder(null)}
        onSubmit={submitRenameFolder}
      />

      <ConfirmDialog
        open={deleteFile !== null}
        title="Delete this file?"
        message={`"${deleteFile?.name}" will be removed and anyone it was shared with will lose access. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={confirmDeleteFile}
        onCancel={() => setDeleteFile(null)}
      />
      <ConfirmDialog
        open={deleteFolder !== null}
        title="Delete this folder?"
        message={`"${deleteFolder?.name}" and everything inside it will be deleted. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={confirmDeleteFolder}
        onCancel={() => setDeleteFolder(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  crumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  toolbar: {
    flexDirection: "row",
    gap: 8,
  },
});
