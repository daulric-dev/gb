"use client";

import { useRef } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, ApiError } from "@/lib/api";
import {
  imageFileProblem,
  IMAGE_UPLOAD_TYPES,
  uploadSchoolLogo,
  UploadError,
} from "@/lib/files/upload";
import { useAuth } from "@/providers/AuthProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Matches the backend's SCHOOL_LOGO_MAX_BYTES. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * The school's logo (school:update only), shown in the sidebar and the
 * student portal in place of the app mark. The current logo comes from the
 * signed-in profile; after a change the profile is reloaded so every place
 * that shows it updates.
 */
export function SchoolLogoSettings() {
  useSignals();
  const { can } = usePermissions();
  const { profile, refresh } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useSignal(false);
  const removing = useSignal(false);

  if (!can("school", "update") || !profile.value?.school) return null;
  const logoUrl = profile.value.school.logo_url ?? null;
  const busy = uploading.value || removing.value;

  const failed = (err: unknown, fallback: string) =>
    toast.error(
      err instanceof ApiError || err instanceof UploadError
        ? err.message
        : fallback,
    );

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = imageFileProblem(file, MAX_LOGO_BYTES);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploading.value = true;
    try {
      await uploadSchoolLogo(file, file.name);
      await refresh();
      toast.success("School logo updated");
    } catch (err) {
      failed(err, "Failed to upload the logo");
    } finally {
      uploading.value = false;
    }
  }

  async function remove() {
    removing.value = true;
    try {
      await api("/schools/current/logo", { method: "DELETE" });
      await refresh();
      toast.success("School logo removed");
    } catch (err) {
      failed(err, "Failed to remove the logo");
    } finally {
      removing.value = false;
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">School logo</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Shown to everyone in your school in the sidebar and the student
        portal. JPEG, PNG or WebP, up to 2MB; a square image works best.
      </p>

      <div className="flex flex-wrap items-center gap-5">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API/CDN
            <img
              src={logoUrl}
              alt="School logo"
              className="size-full object-contain"
            />
          ) : (
            <Image
              src="/icons/logo2.png"
              alt="No logo set"
              width={32}
              height={32}
              className="opacity-60"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {uploading.value ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-2 size-4" />
            )}
            {logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void remove()}
            >
              {removing.value ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_UPLOAD_TYPES.join(",")}
          className="hidden"
          onChange={(e) => void upload(e)}
        />
      </div>
    </Card>
  );
}
