"use client";

import { useEffect } from "react";
import { toast } from "sonner";
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
import { Download, Loader2 } from "lucide-react";
import { fetchFileBlob } from "@/lib/files/content";
import { downloadBlob } from "@/lib/reports/download";
import type { FileItem } from "./types";

export function FileViewerDialog({
  file,
  onClose,
}: {
  file: FileItem | null;
  onClose: () => void;
}) {
  useSignals();
  const url = useSignal<string | null>(null);
  const loading = useSignal(false);
  const failed = useSignal(false);
  const downloading = useSignal(false);

  useEffect(() => {
    if (!file) return;
    loading.value = true;
    failed.value = false;
    let objectUrl: string | null = null;

    fetchFileBlob(file.id, "content")
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        url.value = objectUrl;
      })
      .catch(() => {
        failed.value = true;
        toast.error("Could not load file");
      })
      .finally(() => (loading.value = false));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      url.value = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  async function handleDownload() {
    if (!file) return;
    downloading.value = true;
    try {
      const blob = await fetchFileBlob(file.id, "download");
      downloadBlob(blob, file.name);
    } catch {
      toast.error("Download failed");
    } finally {
      downloading.value = false;
    }
  }

  const contentType = file?.contentType ?? "";
  const isImage = contentType.startsWith("image/");
  const isFrameable =
    contentType === "application/pdf" || contentType.startsWith("text/");

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{file?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex h-[70vh] items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {loading.value ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : failed.value || !url.value ? (
            <p className="text-sm text-muted-foreground">
              Unable to display this file.
            </p>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url.value}
              alt={file?.name ?? ""}
              className="max-h-full max-w-full object-contain"
            />
          ) : isFrameable ? (
            <iframe
              src={url.value}
              title={file?.name ?? "file"}
              className="h-full w-full"
            />
          ) : (
            <div className="px-6 text-center text-sm text-muted-foreground">
              <p>Preview isn’t available for this file type.</p>
              {file?.canDownload && (
                <p className="mt-1">Download it to view the contents.</p>
              )}
            </div>
          )}
        </div>

        {file?.canDownload && (
          <DialogFooter>
            <Button onClick={handleDownload} disabled={downloading.value}>
              <Download className="mr-2 size-4" />
              {downloading.value ? "Downloading…" : "Download"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
