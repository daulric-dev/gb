"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FileItem, FolderItem } from "./types";

/** Create a folder inside `parentId` (null = root). */
export function NewFolderDialog({
  open,
  parentId,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  parentId: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  useSignals();
  const name = useSignal("");
  const busy = useSignal(false);

  useEffect(() => {
    if (open) name.value = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create() {
    const value = name.value.trim();
    if (!value || busy.value) return;
    busy.value = true;
    try {
      await api("/files/folders", {
        method: "POST",
        body: { name: value, parentId: parentId ?? undefined },
      });
      toast.success("Folder created");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to create folder",
      );
    } finally {
      busy.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Organize your files. Only you can see your folders.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Folder name"
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy.value}
          >
            Cancel
          </Button>
          <Button onClick={create} disabled={busy.value || !name.value.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rename one of the owner's (non-system) folders. */
export function RenameFolderDialog({
  folder,
  onClose,
  onRenamed,
}: {
  folder: FolderItem | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  useSignals();
  const name = useSignal("");
  const busy = useSignal(false);

  useEffect(() => {
    if (folder) name.value = folder.name;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.id]);

  async function rename() {
    const value = name.value.trim();
    if (!folder || !value || busy.value) return;
    busy.value = true;
    try {
      await api(`/files/folders/${folder.id}`, {
        method: "PATCH",
        body: { name: value },
      });
      toast.success("Folder renamed");
      onRenamed();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename folder");
    } finally {
      busy.value = false;
    }
  }

  return (
    <Dialog open={folder !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name.value}
          onChange={(e) => (name.value = e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && rename()}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy.value}>
            Cancel
          </Button>
          <Button onClick={rename} disabled={busy.value || !name.value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function pathLabel(folder: FolderItem, byId: Map<string, FolderItem>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur: FolderItem | undefined = folder;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" / ");
}

/** Move a file into one of the owner's folders (or the root). */
export function MoveFileDialog({
  file,
  onClose,
  onMoved,
}: {
  file: FileItem | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  useSignals();
  const folders = useSignal<FolderItem[]>([]);
  const target = useSignal<string>("__root__");
  const busy = useSignal(false);

  useEffect(() => {
    if (!file) return;
    target.value = file.folderId ?? "__root__";
    api<FolderItem[]>("/files/folders")
      .then((f) => (folders.value = f))
      .catch(() => (folders.value = []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  const byId = new Map(folders.value.map((f) => [f.id, f]));
  const options = [...folders.value].sort((a, b) =>
    pathLabel(a, byId).localeCompare(pathLabel(b, byId)),
  );

  async function move() {
    if (!file || busy.value) return;
    busy.value = true;
    try {
      await api(`/files/${file.id}/move`, {
        method: "PATCH",
        body: { folderId: target.value === "__root__" ? null : target.value },
      });
      toast.success("File moved");
      onMoved();
      onClose();
    } catch {
      toast.error("Failed to move file");
    } finally {
      busy.value = false;
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            Move “{file?.name}”
          </DialogTitle>
          <DialogDescription>Choose a destination folder.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Destination</Label>
          <Select
            value={target.value}
            onValueChange={(v) => (target.value = v ?? "__root__")}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__root__">My files (root)</SelectItem>
              {options.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {pathLabel(f, byId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy.value}>
            Cancel
          </Button>
          <Button onClick={move} disabled={busy.value}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
