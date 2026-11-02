"use client";

import { useRef } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  imageFileProblem,
  IMAGE_UPLOAD_TYPES,
  uploadSchoolLogo,
} from "@/lib/files/upload";
import { CURRENT_SCHOOL_API } from "@/lib/organisation";
import { useAuth } from "@/providers/AuthProvider";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Matches the backend's SCHOOL_LOGO_MAX_BYTES. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * The school's logo, shown in the sidebar and the student portal in place of
 * the app mark. By default the active school's (school:update only): the
 * current logo comes from the signed-in profile, and after a change the
 * profile is reloaded so every place that shows it updates. The organisation
 * console passes one school's `apiBase`, `canEdit` and current `logoUrl`.
 */
export function SchoolLogoSettings({
  apiBase = CURRENT_SCHOOL_API,
  canEdit,
  logoUrl: givenLogoUrl,
}: {
  apiBase?: string;
  canEdit?: boolean;
  /** The school's logo when it is not the active school's (null: none). */
  logoUrl?: string | null;
} = {}) {
  useSignals();
  const can = useOptionalCan();
  const { profile, refresh, refreshSilently } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useSignal(false);
  const removing = useSignal(false);
  /** Set after a change on another school's logo (undefined: unchanged). */
  const changed = useSignal<string | null | undefined>(undefined);
  const current = apiBase === CURRENT_SCHOOL_API;

  if (!(canEdit ?? can("school", "update"))) return null;
  if (current && !profile.value?.school) return null;
  const logoUrl = current
    ? (profile.value?.school?.logo_url ?? null)
    : changed.value !== undefined
      ? changed.value
      : (givenLogoUrl ?? null);
  const busy = uploading.value || removing.value;

  /** The profile embeds the active school's logo (maybe this school's). */
  async function afterChange(url: string | null) {
    if (current) {
      await refresh();
    } else {
      changed.value = url;
      void refreshSilently();
    }
  }

  const failed = (err: unknown, fallback: string) =>
    toast.error(userMessage(err, fallback));

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
      const url = await uploadSchoolLogo(file, file.name, undefined, apiBase);
      await afterChange(url);
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
      await api(`${apiBase}/logo`, { method: "DELETE" });
      await afterChange(null);
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
        Shown to everyone in the school in the sidebar and the student
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
