import { bannerGradient, type CourseAppearance } from "@/lib/courses/appearance";
import { cn } from "@/lib/utils";

/**
 * The backdrop of a course header or card, filling its (relative) parent:
 * the cover image with a dark overlay so white text stays readable, else the
 * chosen gradient, else the gradient derived from the course id. The gradient
 * also shows while the image loads.
 */
export function CourseBannerBackdrop({
  course,
  className,
}: {
  course: CourseAppearance;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("absolute inset-0", className)}
      style={{ background: bannerGradient(course) }}
    >
      {course.bannerImageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the API/CDN, already sized */}
          <img
            src={course.bannerImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/15" />
        </>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.22),transparent_50%)]" />
      )}
    </div>
  );
}
