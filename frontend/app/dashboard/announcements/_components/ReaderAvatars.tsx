"use client";

import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { AnnouncementReader } from "./types";

const MAX_SHOWN = 6;

function initials(r: AnnouncementReader) {
  const f = r.first_name?.[0] ?? "";
  const l = r.last_name?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

function fullName(r: AnnouncementReader) {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown";
}

export function ReaderAvatars({ readers }: { readers: AnnouncementReader[] }) {
  if (readers.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">Not read yet</span>
    );
  }

  const shown = readers.slice(0, MAX_SHOWN);
  const extra = readers.length - shown.length;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Read by</span>
      <TooltipProvider delay={150}>
        <AvatarGroup>
          {shown.map((r) => (
            <Tooltip key={r.id}>
              <TooltipTrigger
                render={
                  <Avatar className="size-7 ring-2 ring-background">
                    {r.avatar_url ? (
                      <AvatarImage src={r.avatar_url} alt={fullName(r)} />
                    ) : null}
                    <AvatarFallback className="text-xs">
                      {initials(r)}
                    </AvatarFallback>
                  </Avatar>
                }
              />
              <TooltipContent>{fullName(r)}</TooltipContent>
            </Tooltip>
          ))}
          {extra > 0 && (
            <AvatarGroupCount className="size-7 text-xs">
              +{extra}
            </AvatarGroupCount>
          )}
        </AvatarGroup>
      </TooltipProvider>
    </div>
  );
}
