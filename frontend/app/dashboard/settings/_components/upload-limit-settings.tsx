"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import {
  formatLimitMb,
  UPLOAD_LIMIT_PATH,
  uploadLimitStops,
  type UploadLimit,
} from "@/lib/files/upload-limit";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

/**
 * The school's largest upload (school:update only), picked on a slider that
 * snaps to set stops up to the platform ceiling. "Use platform default"
 * clears the school's own value.
 */
export function UploadLimitSettings() {
  useSignals();
  const { can } = usePermissions();
  const allowed = can("school", "update");
  const limit = useSignal<UploadLimit | null>(null);
  /** The slider's position, in MB. */
  const draft = useSignal(0);
  const saving = useSignal(false);

  useEffect(() => {
    if (!allowed) return;
    api<UploadLimit>(UPLOAD_LIMIT_PATH)
      .then((res) => {
        limit.value = res;
        draft.value = res.uploadLimitMb;
      })
      .catch(() => toast.error("Failed to load the upload limit"));
  }, [allowed, limit, draft]);

  if (!allowed || !limit.value) return null;
  const current = limit.value;
  const stops = uploadLimitStops(current.platformMaxMb, current.maxUploadMb);
  // The slider moves over stop indexes, so every position is a stop.
  const index = Math.max(0, stops.findIndex((mb) => mb >= draft.value));
  const unchanged = draft.value === current.uploadLimitMb;

  async function save(maxUploadMb: number | null) {
    saving.value = true;
    try {
      const res = await api<UploadLimit>(UPLOAD_LIMIT_PATH, {
        method: "PATCH",
        body: { maxUploadMb },
      });
      limit.value = res;
      draft.value = res.uploadLimitMb;
      toast.success(`Uploads are now limited to ${formatLimitMb(res.uploadLimitMb)}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update the upload limit",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Upload size limit</h2>
      <p className="text-sm text-muted-foreground mb-4">
        The largest file anyone in your school can upload, including
        assignment hand-ins. Currently {formatLimitMb(current.uploadLimitMb)}
        {current.maxUploadMb === null ? " (platform default)" : ""}.
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="maxUploadMb">Limit</Label>
          <span className="text-sm font-medium tabular-nums">
            {formatLimitMb(stops[index])}
          </span>
        </div>
        <Slider
          id="maxUploadMb"
          aria-label="Upload size limit"
          min={0}
          max={stops.length - 1}
          step={1}
          value={[index]}
          disabled={saving.value}
          onValueChange={(value) => {
            const i = Array.isArray(value) ? value[0] : value;
            draft.value = stops[i] ?? draft.value;
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatLimitMb(stops[0])}</span>
          <span>{formatLimitMb(stops[stops.length - 1])}</span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={saving.value || unchanged}
            onClick={() => void save(stops[index])}
          >
            {saving.value ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving.value || current.maxUploadMb === null}
            onClick={() => void save(null)}
          >
            Use platform default ({formatLimitMb(current.platformDefaultMb)})
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          PDFs, images and Office files are checked when they are uploaded, so
          the server may cap those lower than this limit.
        </p>
      </div>
    </Card>
  );
}
