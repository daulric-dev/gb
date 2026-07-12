"use client";

import { cn } from "@/lib/utils";

/** A small status dot; green when online, muted otherwise. */
export function PresenceDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      aria-label={online ? "Online" : "Offline"}
      className={cn(
        "inline-block size-2.5 rounded-full",
        online ? "bg-green-500" : "bg-muted-foreground/30",
        className,
      )}
    />
  );
}

/** An avatar-corner presence dot (absolutely positioned, ring for contrast). */
export function AvatarPresenceDot({ online }: { online: boolean }) {
  return (
    <PresenceDot
      online={online}
      className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background"
    />
  );
}
