"use client";

import { useEffect, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchSubmissionFileBlob } from "@/lib/files/content";

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

async function readTextPreview(blob: Blob): Promise<string | null> {
  if (blob.size > MAX_TEXT_PREVIEW_BYTES) return null;

  const buffer = await blob.arrayBuffer();
  try {
    const contents = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(contents)) {
      return null;
    }
    return contents;
  } catch {
    return null;
  }
}

export interface SubmissionFile {
  id: string;
  name: string;
  contentType: string;
  submissionId: string;
}

export function SubmissionFileViewerDialog({
  file,
  score,
  points,
  canGrade,
  saving,
  onSaveGrade,
  onClose,
}: {
  file: SubmissionFile;
  score: number | null;
  points: number;
  canGrade: boolean;
  saving: boolean;
  onSaveGrade: (score: number) => Promise<boolean>;
  onClose: () => void;
}) {
  useSignals();
  const url = useSignal<string | null>(null);
  const text = useSignal<string | null>(null);
  const previewType = useSignal<"pdf" | "image" | "docx" | null>(null);
  const loading = useSignal(true);
  const failed = useSignal(false);
  const grade = useSignal(score === null ? "" : String(score));
  const docxContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const docxElement = docxContainer.current;

    fetchSubmissionFileBlob(file.submissionId, file.id)
      .then(async (blob) => {
        const responseType = blob.type.split(";")[0].trim().toLowerCase();
        const contentType = (
          responseType && responseType !== "application/octet-stream"
            ? responseType
            : file.contentType
        )
          .split(";")[0]
          .trim()
          .toLowerCase();

        if (
          contentType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          const container = docxElement;
          if (!container) throw new Error("Document preview is unavailable");
          container.classList.remove("hidden");
          const { renderAsync } = await import("docx-preview");
          await renderAsync(await blob.arrayBuffer(), container, container, {
            renderAltChunks: false,
            renderChanges: false,
            renderComments: false,
            useBase64URL: true,
          });
          if (active) previewType.value = "docx";
          return;
        }

        if (
          contentType === "application/pdf" ||
          ["image/png", "image/jpeg", "image/webp"].includes(contentType)
        ) {
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: contentType }),
          );
          if (active) {
            url.value = objectUrl;
            previewType.value =
              contentType === "application/pdf" ? "pdf" : "image";
          } else {
            URL.revokeObjectURL(objectUrl);
          }
          return;
        }

        const contents = await readTextPreview(blob);
        if (active && contents !== null) {
          text.value = contents;
        }
      })
      .catch(() => {
        if (!active) return;
        failed.value = true;
        toast.error("Could not load submission file");
      })
      .finally(() => {
        if (active) loading.value = false;
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      docxElement?.replaceChildren();
    };
  }, [
    failed,
    file.contentType,
    file.id,
    file.submissionId,
    loading,
    previewType,
    text,
    url,
  ]);

  async function saveGrade() {
    const value = Number(grade.value);
    if (grade.value.trim() === "" || !Number.isFinite(value) || value < 0) {
      toast.error("Enter a score of 0 or more");
      grade.value = score === null ? "" : String(score);
      return;
    }
    if (value > points) {
      toast.error(`Score cannot exceed ${points}`);
      return;
    }
    if (value !== score && (await onSaveGrade(value))) {
      grade.value = String(value);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex h-[min(92vh,60rem)] w-[calc(100vw-2rem)] flex-col gap-4 sm:max-w-7xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8">{file.name}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {loading.value ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : text.value !== null ? (
            <pre className="h-full w-full overflow-auto whitespace-pre-wrap wrap-break-words p-4 text-left font-mono text-sm">
              {text.value}
            </pre>
          ) : failed.value ? (
            <p className="text-sm text-muted-foreground">
              Unable to display this file.
            </p>
          ) : url.value ? (
            previewType.value === "pdf" ? (
              <iframe
                src={url.value}
                title={file.name}
                className="h-full w-full"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url.value}
                alt={file.name}
                className="h-full w-full object-contain"
              />
            )
          ) : previewType.value !== "docx" ? (
            <p className="px-6 text-center text-sm text-muted-foreground">
              This file is not a supported text or document preview, or is
              larger than 1 MB. Download the submission ZIP to open it.
            </p>
          ) : null}
          <div
            ref={docxContainer}
            className={
              previewType.value === "docx"
                ? "h-full w-full overflow-auto bg-background text-foreground"
                : "hidden"
            }
          />
        </div>
        {canGrade && (
          <DialogFooter className="shrink-0 sm:items-end">
            <div className="mr-auto flex items-center gap-2">
              <label htmlFor="submission-grade" className="text-sm font-medium">
                Grade
              </label>
              <Input
                id="submission-grade"
                type="number"
                min={0}
                max={points}
                step={0.01}
                aria-label="Grade"
                className="w-28"
                value={grade.value}
                disabled={saving}
                onChange={(event) => (grade.value = event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveGrade();
                }}
              />
              <span className="text-sm text-muted-foreground">/{points}</span>
            </div>
            <Button onClick={() => void saveGrade()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save grade
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
