"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { uploadResumable } from "@/lib/files/resumable";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";

const MAX_SIZE = 10 * 1024 * 1024;

export function UploadButton({
  onUploaded,
  folderId = null,
}: {
  onUploaded: () => void;
  /** Place the upload into this folder; null uploads to the root. */
  folderId?: string | null;
}) {
  useSignals();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = useSignal(false);
  const progress = useSignal(0);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;

    if (file.size > MAX_SIZE) {
      toast.error("File must be under 10MB");
      return;
    }

    uploading.value = true;
    progress.value = 0;
    try {
      await uploadResumable(
        file,
        {
          ticket: "/files/upload-ticket",
          complete: (fileId) => `/files/upload-ticket/${fileId}/complete`,
        },
        {
          folderId: folderId ?? undefined,
          onProgress: (fraction) => (progress.value = fraction),
        },
      );
      toast.success("File uploaded");
      onUploaded();
    } catch (err) {
      // The scan and the signature check both report through here, so the
      // reason is worth showing rather than a flat "upload failed".
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed",
      );
    } finally {
      uploading.value = false;
      progress.value = 0;
    }
  }

  const percent = Math.round(progress.value * 100);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={uploading.value}
      >
        <Upload className="mr-2 size-4" />
        {uploading.value
          ? percent > 0 && percent < 100
            ? `Uploading ${percent}%`
            : "Uploading…"
          : "Upload"}
      </Button>
    </>
  );
}
