"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getCurrentPosition, type Position } from "@/lib/attendance";
import type { AttendanceSessionDetail } from "@/lib/courses/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUICK_MINUTES = [2, 5, 10, 15];
const RADII = [50, 100, 200, 500];
const RADIUS_ITEMS = RADII.map((r) => ({ value: String(r), label: `${r} m` }));

export function TakeAttendanceDialog({
  open,
  onOpenChangeAction,
  courseId,
  base,
}: {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  courseId: string;
  base: string;
}) {
  useSignals();
  const router = useRouter();

  const minutes = useSignal("5");
  const requireCode = useSignal(true);
  const lateAfter = useSignal("");
  const checkLocation = useSignal(false);
  const position = useSignal<Position | null>(null);
  const locating = useSignal(false);
  const radius = useSignal("100");
  const title = useSignal("");
  const saving = useSignal(false);

  const mins = Number(minutes.value);
  const minutesValid = Number.isInteger(mins) && mins >= 1 && mins <= 60;
  const late = lateAfter.value.trim() === "" ? null : Number(lateAfter.value);
  const lateValid =
    late === null || (Number.isInteger(late) && late >= 0 && late <= 60);
  const canSubmit =
    minutesValid &&
    lateValid &&
    (!checkLocation.value || position.value !== null) &&
    !saving.value &&
    !locating.value;

  async function locate() {
    locating.value = true;
    try {
      position.value = await getCurrentPosition();
    } catch (err) {
      position.value = null;
      checkLocation.value = false;
      toast.error(err instanceof Error ? err.message : "Could not get location");
    } finally {
      locating.value = false;
    }
  }

  function toggleLocation(on: boolean) {
    checkLocation.value = on;
    if (on && !position.value) void locate();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    saving.value = true;
    try {
      const pos = checkLocation.value ? position.value : null;
      const session = await api<AttendanceSessionDetail>(
        `/courses/${courseId}/attendance/sessions`,
        {
          method: "POST",
          body: {
            durationMinutes: mins,
            requireCode: requireCode.value,
            ...(late !== null ? { lateAfterMinutes: late } : {}),
            ...(title.value.trim() ? { title: title.value.trim() } : {}),
            ...(pos
              ? {
                  location: {
                    latitude: pos.latitude,
                    longitude: pos.longitude,
                    radiusM: Number(radius.value),
                  },
                }
              : {}),
          },
        },
      );
      onOpenChangeAction(false);
      router.push(`${base}/attendance/${session.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not start attendance",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Take attendance</DialogTitle>
            <DialogDescription>
              Students get a notification and check in from their phone or the
              portal. Anyone who has not checked in when it closes is marked
              absent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="att-minutes">Open for (minutes)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="att-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                className="w-20"
                value={minutes.value}
                aria-invalid={!minutesValid}
                onChange={(e) => (minutes.value = e.target.value)}
              />
              {QUICK_MINUTES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={mins === m ? "default" : "outline"}
                  onClick={() => (minutes.value = String(m))}
                >
                  {m} min
                </Button>
              ))}
            </div>
            {!minutesValid && (
              <p className="text-xs text-destructive">Between 1 and 60 minutes.</p>
            )}
          </div>

          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Require room code</span>
              <span className="block text-xs text-muted-foreground">
                Show a 4-digit code on screen that students type in.
              </span>
            </span>
            <Switch
              checked={requireCode.value}
              onCheckedChange={(v) => (requireCode.value = v)}
            />
          </label>

          <div className="space-y-2">
            <Label htmlFor="att-late">Mark late after (minutes)</Label>
            <Input
              id="att-late"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              placeholder="Never"
              className="w-28"
              value={lateAfter.value}
              aria-invalid={!lateValid}
              onChange={(e) => (lateAfter.value = e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Check-ins after this are recorded as late. Leave empty to count
              everyone as present.
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Check location</span>
                <span className="block text-xs text-muted-foreground">
                  Students must be near where you are now.
                </span>
              </span>
              <Switch
                checked={checkLocation.value}
                onCheckedChange={toggleLocation}
              />
            </label>
            {checkLocation.value && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-sm">
                  {locating.value ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Finding your location…
                    </>
                  ) : position.value ? (
                    <>
                      <MapPin className="size-4 text-emerald-600" />
                      <span>
                        Location set
                        <span
                          className={cn(
                            "ml-1 text-muted-foreground",
                            position.value.accuracy > 100 && "text-amber-600",
                          )}
                        >
                          (±{Math.round(position.value.accuracy)} m)
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No location yet</span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={locating.value}
                    onClick={() => void locate()}
                  >
                    <LocateFixed className="mr-1.5 size-4" />
                    Refresh
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="shrink-0">Radius</Label>
                  <Select
                    value={radius.value}
                    onValueChange={(v) => (radius.value = String(v))}
                    items={RADIUS_ITEMS}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RADIUS_ITEMS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="att-title">Title (optional)</Label>
            <Input
              id="att-title"
              placeholder="e.g. Lab session"
              maxLength={120}
              value={title.value}
              onChange={(e) => (title.value = e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChangeAction(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Start
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
