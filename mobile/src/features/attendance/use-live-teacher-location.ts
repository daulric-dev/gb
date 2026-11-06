import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { api, ApiError } from "@/lib/api";
import {
  shouldSendLocation,
  type SentPoint,
} from "@/lib/attendance-location";

export interface LocationUpdate {
  location: { latitude: number; longitude: number; radiusM: number };
  locationUpdatedAt: string;
}

export type LiveLocationState =
  | "waiting"
  | "live"
  | "denied"
  | "error";

/**
 * Follows this phone with a foreground `watchPositionAsync` while `active &&
 * sharing`, and moves the open session's point when the teacher has moved
 * 20 m or 30 s have passed (never closer than the API's 5 s throttle).
 * Foreground only: no background location permission is asked for, so the
 * point simply stops moving while the app is in the background. The watch
 * is removed when sharing stops, the session closes or the screen unmounts;
 * the last point sent stays on the session.
 */
export function useLiveTeacherLocation({
  courseId,
  sessionId,
  active,
  sharing,
  current,
  onUpdated,
  onClosed,
}: {
  courseId: string;
  sessionId: string;
  active: boolean;
  sharing: boolean;
  /** The session's point as last loaded, so a fresh one is not re-sent. */
  current: SentPoint | null;
  onUpdated: (update: LocationUpdate) => void;
  onClosed: () => void;
}): LiveLocationState {
  const [state, setState] = useState<LiveLocationState>("waiting");
  const last = useRef<SentPoint | null>(current);
  const callbacks = useRef({ onUpdated, onClosed });
  useEffect(() => {
    callbacks.current = { onUpdated, onClosed };
  }, [onUpdated, onClosed]);
  useEffect(() => {
    if (current && (!last.current || current.at > last.current.at)) {
      last.current = current;
    }
  }, [current]);

  useEffect(() => {
    if (!active || !sharing) return;
    let stopped = false;
    let inFlight = false;
    let sub: Location.LocationSubscription | null = null;
    const url = `/courses/${courseId}/attendance/sessions/${sessionId}/location`;
    setState("waiting");

    async function send(pos: Location.LocationObject) {
      if (stopped || inFlight) return;
      const fix = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      };
      if (!shouldSendLocation(last.current, fix, Date.now())) {
        if (last.current) setState("live");
        return;
      }
      inFlight = true;
      try {
        const res = await api<LocationUpdate | "">(url, {
          method: "PATCH",
          body: fix,
        });
        if (stopped) return;
        setState("live");
        // 204: the API judged the fix too coarse; the point stays.
        if (!res || typeof res !== "object") return;
        last.current = {
          latitude: res.location.latitude,
          longitude: res.location.longitude,
          at: Date.parse(res.locationUpdatedAt),
        };
        callbacks.current.onUpdated(res);
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 429) return;
        if (err instanceof ApiError && err.status === 409) {
          stopped = true;
          sub?.remove();
          callbacks.current.onClosed();
          return;
        }
        setState("error");
      } finally {
        inFlight = false;
      }
    }

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (stopped) return;
        if (!permission.granted) {
          setState("denied");
          return;
        }
        const watch = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5_000,
            distanceInterval: 5,
          },
          (pos) => void send(pos),
          () => !stopped && setState("error"),
        );
        if (stopped) watch.remove();
        else sub = watch;
      } catch {
        if (!stopped) setState("error");
      }
    })();

    return () => {
      stopped = true;
      sub?.remove();
      sub = null;
    };
  }, [active, sharing, courseId, sessionId]);

  return state;
}
