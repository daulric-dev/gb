"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { apiUpload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";

const MAX_SIZE = 10 * 1024 * 1024;

export function UploadButton({ onUploaded }: { onUploaded: () => void }) {
  useSignals();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = useSignal(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;

    if (file.size > MAX_SIZE) {
      toast.error("File must be under 10MB");
      return;
    }

    uploading.value = true;
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      await apiUpload(`/files?name=${encodeURIComponent(file.name)}`, formData);
      toast.success("File uploaded — it will be available once scanned");
      onUploaded();
    } catch {
      toast.error("Upload failed");
    } finally {
      uploading.value = false;
    }
  }

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
        {uploading.value ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}
