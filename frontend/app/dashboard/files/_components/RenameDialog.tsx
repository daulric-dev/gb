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
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FileItem } from "./types";

export function RenameDialog({
  file,
  onClose,
  onRenamed,
}: {
  file: FileItem | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  useSignals();
  const name = useSignal("");
  const busy = useSignal(false);

  useEffect(() => {
    if (file) name.value = file.name;
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!file || !name.value.trim()) return;
    busy.value = true;
    try {
      await api(`/files/${file.id}`, {
        method: "PATCH",
        body: { name: name.value.trim() },
      });
      toast.success("File renamed");
      onRenamed();
      onClose();
    } catch {
      toast.error("Failed to rename");
    } finally {
      busy.value = false;
    }
  }

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="file-name">Name</Label>
          <Input
            id="file-name"
            value={name.value}
            onChange={(e) => (name.value = e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy.value}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy.value || !name.value.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
