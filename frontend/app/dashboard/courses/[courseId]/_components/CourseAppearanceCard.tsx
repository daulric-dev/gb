"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  bannerGradient,
  COURSE_BANNER_COLORS,
  COURSE_BANNER_PRESETS,
  type CourseBannerColor,
} from "@/lib/courses/appearance";
import { courseGradient } from "@/lib/courses/format";
import {
  imageFileProblem,
  IMAGE_UPLOAD_TYPES,
  uploadCourseBanner,
  UploadError,
} from "@/lib/files/upload";
import { cn } from "@/lib/utils";
import { CourseBannerBackdrop } from "@/components/courses/course-banner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useCourse } from "./course-context";

/** Matches the backend's COURSE_BANNER_MAX_BYTES. */
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError || err instanceof UploadError
    ? err.message
    : fallback;
}

/**
 * The course banner: a colour preset (or Auto, derived from the id) and an
 * optional cover image drawn over it. Each change saves at once, apart from
 * the settings form; the header above reloads with it.
 */
export function CourseAppearanceCard({ className }: { className?: string }) {
  useSignals();
  const { course, reload } = useCourse();
  const fileInput = useRef<HTMLInputElement>(null);
  const savingColor = useSignal<CourseBannerColor | "auto" | null>(null);
  const uploading = useSignal(false);
  const progress = useSignal(0);
  const removing = useSignal(false);

  async function setColor(color: CourseBannerColor | null) {
    if ((course.bannerColor ?? null) === color) return;
    savingColor.value = color ?? "auto";
    try {
      await api(`/courses/${course.id}`, {
        method: "PATCH",
        body: { bannerColor: color },
      });
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to change the colour"));
    } finally {
      savingColor.value = null;
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = imageFileProblem(file, MAX_BANNER_BYTES);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploading.value = true;
    progress.value = 0;
    try {
      await uploadCourseBanner(course.id, file, file.name, (f) => {
        progress.value = f;
      });
      await reload();
      toast.success("Cover image updated");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to upload the image"));
    } finally {
      uploading.value = false;
    }
  }

  async function removeImage() {
    removing.value = true;
    try {
      await api(`/courses/${course.id}/banner`, { method: "DELETE" });
      await reload();
      toast.success("Cover image removed");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to remove the image"));
    } finally {
      removing.value = false;
    }
  }

  const busy = uploading.value || removing.value;
  const swatches: { key: CourseBannerColor | null; label: string; bg: string }[] = [
    { key: null, label: "Auto", bg: courseGradient(course.id) },
    ...COURSE_BANNER_COLORS.map((key) => ({
      key,
      label: COURSE_BANNER_PRESETS[key].label,
      bg: bannerGradient({ id: course.id, bannerColor: key }),
    })),
  ];

  return (
    <Card id="appearance" className={cn("scroll-mt-4", className)}>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          The banner behind the course name, here and on students&apos;
          course cards. A cover image is shown over the colour.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="relative h-28 overflow-hidden rounded-lg text-white">
          <CourseBannerBackdrop course={course} />
          <div className="relative flex h-full flex-col justify-end p-4">
            <p className="truncate text-lg font-bold">{course.name}</p>
            {course.code && (
              <p className="font-mono text-xs text-white/85">{course.code}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Colour</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Banner colour">
            {swatches.map((s) => {
              const selected = (course.bannerColor ?? null) === s.key;
              const saving = savingColor.value === (s.key ?? "auto");
              return (
                <button
                  key={s.key ?? "auto"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={s.label}
                  title={s.label}
                  disabled={savingColor.value !== null}
                  onClick={() => void setColor(s.key)}
                  className={cn(
                    "relative flex size-9 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    selected && "ring-2 ring-foreground",
                  )}
                  style={{ background: s.bg }}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : selected ? (
                    <Check className="size-4" />
                  ) : s.key === null ? (
                    <span className="text-[10px] font-semibold">Auto</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Cover image</Label>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG or WebP, up to 5MB. A wide image (about 3:1) fits best.
          </p>
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
              {uploading.value
                ? `Uploading ${Math.round(progress.value * 100)}%`
                : course.bannerImageUrl
                  ? "Replace image"
                  : "Upload image"}
            </Button>
            {course.bannerImageUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void removeImage()}
              >
                {removing.value ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 size-4" />
                )}
                Remove image
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
      </CardContent>
    </Card>
  );
}
