"use client";

import { useEffect, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { MapPin, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AttendanceRosterEntry } from "@/lib/courses/types";
import { useNow } from "@/lib/attendance";
import {
  describeLocationFlags,
  formatAgo,
  shouldSendLocation,
  type SentPoint,
} from "@/lib/attendance-location";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface LocationUpdate {
  location: { latitude: number; longitude: number; radiusM: number };
  locationUpdatedAt: string;
}

type LiveState = "waiting" | "live" | "denied" | "unavailable" | "error";

/**
 * Follows this device with `watchPosition` while `active && sharing`, and
 * moves the open session's point when the teacher has moved 20 m or 30 s
 * have passed (never closer than the API's 5 s throttle). The watch is
 * cleared when sharing stops, the session closes, or the page unmounts;
 * the last point sent stays on the session.
 */
export function useLiveTeacherLocation({
  sessionPath,
  active,
  sharing,
  current,
  onUpdated,
  onClosed,
}: {
  sessionPath: string;
  active: boolean;
  sharing: boolean;
  /** The session's point as last loaded, so a fresh one is not re-sent. */
  current: SentPoint | null;
  onUpdated: (update: LocationUpdate) => void;
  onClosed: () => void;
}): LiveState {
  useSignals();
  const state = useSignal<LiveState>("waiting");
  const last = useRef<SentPoint | null>(current);
  const callbacks = useRef({ onUpdated, onClosed });
  useEffect(() => {
    callbacks.current = { onUpdated, onClosed };
  }, [onUpdated, onClosed]);
  useEffect(() => {
    // A newer point from the server (another device, a reload) wins.
    if (current && (!last.current || current.at > last.current.at)) {
      last.current = current;
    }
  }, [current]);

  useEffect(() => {
    if (!active || !sharing) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      state.value = "unavailable";
      return;
    }
    state.value = "waiting";
    let stopped = false;
    let inFlight = false;

    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped || inFlight) return;
        const fix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        if (!shouldSendLocation(last.current, fix, Date.now())) {
          state.value = state.value === "waiting" && last.current ? "live" : state.value;
          return;
        }
        inFlight = true;
        api<LocationUpdate | "">(`${sessionPath}/location`, {
          method: "PATCH",
          body: fix,
        })
          .then((res) => {
            if (stopped) return;
            state.value = "live";
            // 204: the API judged the fix too coarse; the point stays.
            if (!res || typeof res !== "object") return;
            last.current = {
              latitude: res.location.latitude,
              longitude: res.location.longitude,
              at: Date.parse(res.locationUpdatedAt),
            };
            callbacks.current.onUpdated(res);
          })
          .catch((err) => {
            if (stopped) return;
            if (err instanceof ApiError && err.status === 429) return;
            if (err instanceof ApiError && err.status === 409) {
              stopped = true;
              navigator.geolocation.clearWatch(watch);
              callbacks.current.onClosed();
              return;
            }
            state.value = "error";
          })
          .finally(() => {
            inFlight = false;
          });
      },
      (err) => {
        if (stopped) return;
        state.value = err.code === err.PERMISSION_DENIED ? "denied" : "error";
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
    );

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
    };
  }, [active, sharing, sessionPath, state]);

  return state.value;
}

/** "Location live · updated 12s ago" with the switch to stop sharing. */
export function LiveLocationBar({
  state,
  sharing,
  onSharingChange,
  updatedAt,
  radiusM,
}: {
  state: LiveState;
  sharing: boolean;
  onSharingChange: (v: boolean) => void;
  updatedAt: string | null;
  radiusM: number;
}) {
  const now = useNow(1000);
  const ago = formatAgo(updatedAt, now);
  let text: string;
  if (!sharing) text = `Location paused · using the point from ${ago}`;
  else if (state === "denied") text = "Location blocked in this browser · using the last point";
  else if (state === "unavailable") text = "This browser cannot share its location";
  else if (state === "error") text = `Location signal lost · updated ${ago}`;
  else if (state === "waiting") text = `Finding your location… · updated ${ago}`;
  else text = `Location live · updated ${ago}`;
  const live = sharing && state === "live";

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span
          className={cn(
            "size-2 rounded-full",
            live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <MapPin className="size-3.5" />
        <span>{text}</span>
        <span className="text-xs">({radiusM} m)</span>
      </span>
      <label className="inline-flex items-center gap-2">
        <Switch checked={sharing} onCheckedChange={onSharingChange} />
        <span>Share my location</span>
      </label>
    </div>
  );
}

/** A warning on a check-in whose location looked odd; staff only. */
export function LocationFlagBadge({ entry }: { entry: AttendanceRosterEntry }) {
  const flags = entry.locationFlags ?? [];
  if (flags.length === 0) return null;
  const lines = describeLocationFlags(flags, entry.distanceM);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="ml-1.5 inline-flex align-middle text-amber-600 dark:text-amber-400"
            aria-label={`Location looks unusual: ${lines.join("; ")}`}
            data-private-label
          />
        }
      >
        <TriangleAlert className="size-4" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">Location looks unusual</p>
        <ul className="mt-1 list-disc pl-4" translate="no">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-1 opacity-80">Recorded only; the check-in was accepted.</p>
      </TooltipContent>
    </Tooltip>
  );
}
