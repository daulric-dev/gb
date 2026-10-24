"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  ATTENDANCE_STATUS_LABEL,
  checkInErrorMessage,
  formatCountdown,
  getCurrentPosition,
  useCountdown,
} from "@/lib/attendance";
import type { PortalOpenAttendance } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  refreshOpenAttendance,
  removeOpenAttendance,
  upsertOpenAttendance,
} from "./attendance-store";

async function submitCheckIn(
  session: PortalOpenAttendance,
  code: string | null,
): Promise<PortalOpenAttendance | null> {
  try {
    const location = session.requiresLocation
      ? await getCurrentPosition()
      : null;
    const result = await api<PortalOpenAttendance>(
      `/portal/me/attendance/${session.sessionId}/check-in`,
      {
        method: "POST",
        body: {
          ...(code ? { code } : {}),
          ...(location
            ? {
                location: {
                  latitude: location.latitude,
                  longitude: location.longitude,
                  accuracy: location.accuracy,
                },
              }
            : {}),
        },
      },
    );
    upsertOpenAttendance(result);
    const status = result.myStatus
      ? ATTENDANCE_STATUS_LABEL[result.myStatus].toLowerCase()
      : "present";
    toast.success(`You're checked in (${status})`);
    return result;
  } catch (err) {
    toast.error(checkInErrorMessage(err));
    if (err instanceof ApiError && err.status === 409) {
      if (/closed/i.test(err.message)) removeOpenAttendance(session.sessionId);
      else if (/already/i.test(err.message)) void refreshOpenAttendance();
    }
    return null;
  }
}

function CheckInDialog({
  session,
  open,
  onOpenChangeAction,
  onCheckedInAction,
}: {
  session: PortalOpenAttendance;
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onCheckedInAction?: (result: PortalOpenAttendance) => void;
}) {
  useSignals();
  const code = useSignal("");
  const busy = useSignal(false);
  const remaining = useCountdown(session.closesAt);

  const ready =
    !busy.value && remaining > 0 && (!session.requiresCode || code.value.length === 4);

  async function submit() {
    if (!ready) return;
    busy.value = true;
    const result = await submitCheckIn(
      session,
      session.requiresCode ? code.value : null,
    );
    busy.value = false;
    if (result) {
      code.value = "";
      onOpenChangeAction(false);
      onCheckedInAction?.(result);
    } else {
      code.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Check in to {session.courseName}</DialogTitle>
            <DialogDescription>
              {session.title ? `${session.title} · ` : ""}
              closes in{" "}
              <span className="font-medium tabular-nums">
                {formatCountdown(remaining)}
              </span>
            </DialogDescription>
          </DialogHeader>

          {session.requiresCode && (
            <div className="space-y-2">
              <p className="text-center text-sm text-muted-foreground">
                Enter the 4-digit code on the screen
              </p>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={4}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode="numeric"
                  autoFocus
                  value={code.value}
                  onChange={(v) => (code.value = v)}
                  disabled={busy.value}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="size-12 font-mono text-2xl"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>
          )}

          {session.requiresLocation && (
            <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-muted-foreground">
                Your teacher asked to confirm you are in the room. Your browser
                will ask to share your location once, only for this check-in.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChangeAction(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {busy.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {busy.value && session.requiresLocation
                ? "Checking location…"
                : "Check in"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Check in" button for one open session. Goes straight to the API when no
 * code or location is needed, otherwise opens the check-in dialog.
 */
export function CheckInButton({
  session,
  onCheckedInAction,
  className,
  size,
}: {
  session: PortalOpenAttendance;
  onCheckedInAction?: (result: PortalOpenAttendance) => void;
  className?: string;
  size?: "default" | "sm" | "lg";
}) {
  useSignals();
  const open = useSignal(false);
  const busy = useSignal(false);

  async function click() {
    if (session.requiresCode || session.requiresLocation) {
      open.value = true;
      return;
    }
    busy.value = true;
    const result = await submitCheckIn(session, null);
    busy.value = false;
    if (result) onCheckedInAction?.(result);
  }

  return (
    <>
      <Button
        size={size}
        className={className}
        onClick={() => void click()}
        disabled={busy.value}
      >
        {busy.value && <Loader2 className="mr-2 size-4 animate-spin" />}
        Check in
      </Button>
      <CheckInDialog
        session={session}
        open={open.value}
        onOpenChangeAction={(v) => (open.value = v)}
        onCheckedInAction={onCheckedInAction}
      />
    </>
  );
}

export function CheckedInPill({
  status,
  className,
}: {
  status: PortalOpenAttendance["myStatus"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      <CheckCircle2 className="size-3.5" />
      Checked in{status === "late" ? " (late)" : ""}
    </span>
  );
}
