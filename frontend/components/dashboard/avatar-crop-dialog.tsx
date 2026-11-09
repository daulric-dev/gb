"use client";

import { useCallback } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Loader2, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AvatarCropDialogProps {
  imageSrc: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => void;
  uploading?: boolean;
}

async function getCroppedBlob(
  imageSrc: string,
  crop: Area,
): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const size = Math.min(crop.width, crop.height);
  const outputSize = Math.min(size, 512);
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))),
      "image/jpeg",
      0.9,
    );
  });
}

export function AvatarCropDialog({
  imageSrc,
  open,
  onOpenChange,
  onConfirm,
  uploading = false,
}: AvatarCropDialogProps) {
  useSignals();
  const crop = useSignal({ x: 0, y: 0 });
  const zoom = useSignal(1);
  const rotation = useSignal(0);
  const croppedArea = useSignal<Area | null>(null);

  const onCropComplete = useCallback(
    (_: Area, croppedAreaPixels: Area) => {
      croppedArea.value = croppedAreaPixels;
    },
    [croppedArea],
  );

  async function handleConfirm() {
    if (!imageSrc || !croppedArea.value) return;
    const blob = await getCroppedBlob(imageSrc, croppedArea.value);
    onConfirm(blob);
  }

  function handleClose(value: boolean) {
    if (uploading) return;
    if (!value) {
      crop.value = { x: 0, y: 0 };
      zoom.value = 1;
      rotation.value = 0;
      croppedArea.value = null;
    }
    onOpenChange(value);
  }

  if (!imageSrc) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crop Profile Picture</DialogTitle>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
          <Cropper
            image={imageSrc}
            crop={crop.value}
            zoom={zoom.value}
            rotation={rotation.value}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={(next) => (crop.value = next)}
            onZoomChange={(next) => (zoom.value = next)}
            onRotationChange={(next) => (rotation.value = next)}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut className="size-4 shrink-0 text-muted-foreground" />
            <Slider
              min={1}
              max={3}
              step={0.05}
              value={[zoom.value]}
              onValueChange={(value) => (zoom.value = Array.isArray(value) ? value[0] : value)}
            />
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
          </div>

          <div className="flex items-center gap-3">
            <RotateCw className="size-4 shrink-0 text-muted-foreground" />
            <Slider
              min={0}
              max={360}
              step={1}
              value={[rotation.value]}
              onValueChange={(value) => (rotation.value = Array.isArray(value) ? value[0] : value)}
            />
            <span className="text-xs text-muted-foreground w-8 text-right">{rotation.value}°</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={uploading || !croppedArea.value}>
            {uploading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
