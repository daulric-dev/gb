"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, LocateFixed, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { getCurrentPosition } from "@/lib/attendance";
import {
  browserTimeZone,
  formatDay,
  minutesToTime,
  timeRange,
  timeToMinutes,
  weekdayLabel,
  WEEKDAYS,
  type CyclePreview,
  type Period,
  type Room,
  type TimetableSettings,
  type TimetableSetup,
} from "@/lib/timetable";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PATH = "/schools/current/timetable";

/**
 * The school's timetable setup: time zone and cycle, rooms (with a saved
 * location for check-in), the bell schedule and non-school days. Anyone
 * on staff can read it; changes need school:update.
 */
export default function TimetableSetupPage() {
  useSignals();
  const can = useOptionalCan();
  const canEdit = can("school", "update");
  const setup = useSignal<TimetableSetup | null>(null);
  const error = useSignal<string | null>(null);

  const load = useCallback(async () => {
    try {
      setup.value = await api<TimetableSetup>(PATH);
      error.value = null;
    } catch (err) {
      error.value = userMessage(err, "Could not load the timetable setup");
    }
  }, [setup, error]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Timetable setup"
        description="Time zone, bell schedule, rooms and school closures. Courses add their periods from their own Timetable tab."
      />
      {error.value ? (
        <p role="alert" className="text-sm text-destructive">
          {error.value}
        </p>
      ) : !setup.value ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <SettingsCard settings={setup.value.settings} canEdit={canEdit} onSaved={load} />
          <PeriodsCard periods={setup.value.periods} schoolDays={setup.value.settings.schoolDays} canEdit={canEdit} onSaved={load} />
          <RoomsCard rooms={setup.value.rooms} canEdit={canEdit} onSaved={load} />
          <ClosuresCard setup={setup.value} canEdit={canEdit} onSaved={load} />
          {setup.value.settings.cycleLength && <CycleCard today={setup.value.today} />}
        </>
      )}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsCard({
  settings,
  canEdit,
  onSaved,
}: {
  settings: TimetableSettings;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  useSignals();
  const draft = useSignal<TimetableSettings>(settings);
  const saving = useSignal(false);
  const err = useSignal<string | null>(null);
  useEffect(() => {
    draft.value = settings;
  }, [settings, draft]);

  const d = draft.value;
  const set = (patch: Partial<TimetableSettings>) => (draft.value = { ...draft.value, ...patch });
  const suggestion = browserTimeZone();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    saving.value = true;
    err.value = null;
    try {
      await api(`${PATH}/settings`, {
        method: "PATCH",
        body: {
          timeZone: d.timeZone.trim(),
          cycleLength: d.cycleLength,
          cycleStartDate: d.cycleLength ? d.cycleStartDate : null,
          schoolDays: d.schoolDays,
          autoSessions: d.autoSessions,
          leadMinutes: d.leadMinutes,
          lateAfterMinutes: d.lateAfterMinutes,
          requireCode: d.requireCode,
        },
      });
      toast.success("Timetable settings saved");
      await onSaved();
    } catch (e2) {
      err.value = userMessage(e2, "Could not save the settings");
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule and check-in</CardTitle>
        <CardDescription>
          Times are in the school&apos;s time zone, so clock changes are handled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={!canEdit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tz">Time zone</Label>
                <Input
                  id="tz"
                  value={d.timeZone}
                  onChange={(e) => set({ timeZone: e.target.value })}
                  placeholder="Europe/London"
                  aria-describedby="tz-hint"
                />
                <p id="tz-hint" className="text-xs text-muted-foreground">
                  An IANA zone name.
                  {suggestion && suggestion !== d.timeZone && canEdit && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => set({ timeZone: suggestion })}
                      >
                        Use {suggestion}
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle">Timetable</Label>
                <select
                  id="cycle"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  value={d.cycleLength ? "rotating" : "weekly"}
                  onChange={(e) =>
                    set(
                      e.target.value === "weekly"
                        ? { cycleLength: null }
                        : { cycleLength: d.cycleLength ?? 2, cycleStartDate: d.cycleStartDate ?? "" },
                    )
                  }
                >
                  <option value="weekly">Weekly (same every week)</option>
                  <option value="rotating">Rotating cycle of days</option>
                </select>
              </div>
              {d.cycleLength && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="cycle-len">Days in the cycle</Label>
                    <Input
                      id="cycle-len"
                      type="number"
                      min={2}
                      max={20}
                      value={d.cycleLength}
                      onChange={(e) => set({ cycleLength: Number(e.target.value) || 2 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cycle-start">Date of day 1</Label>
                    <Input
                      id="cycle-start"
                      type="date"
                      required
                      value={d.cycleStartDate ?? ""}
                      onChange={(e) => set({ cycleStartDate: e.target.value })}
                      aria-describedby="cycle-hint"
                    />
                    <p id="cycle-hint" className="text-xs text-muted-foreground">
                      The cycle counts school days only; closures and weekends do not use up a day.
                    </p>
                  </div>
                </>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">School days</legend>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((w) => (
                  <label key={w} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={d.schoolDays.includes(w)}
                      onChange={(e) =>
                        set({
                          schoolDays: e.target.checked
                            ? [...d.schoolDays, w].sort()
                            : d.schoolDays.filter((x) => x !== w),
                        })
                      }
                    />
                    {weekdayLabel(w, true)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                <div>
                  <Label htmlFor="auto">Open attendance automatically</Label>
                  <p className="text-xs text-muted-foreground">
                    A check-in session opens at the start of each timetabled period and closes at its end; whoever has not checked in is marked absent.
                  </p>
                </div>
                <Switch id="auto" checked={d.autoSessions} onCheckedChange={(v) => set({ autoSessions: v })} disabled={!canEdit} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead">Open this many minutes early</Label>
                <Input
                  id="lead"
                  type="number"
                  min={0}
                  max={30}
                  value={d.leadMinutes}
                  onChange={(e) => set({ leadMinutes: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="late">Late after (minutes from the start)</Label>
                <Input
                  id="late"
                  type="number"
                  min={0}
                  max={240}
                  placeholder="Never late"
                  value={d.lateAfterMinutes ?? ""}
                  onChange={(e) => set({ lateAfterMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                <div>
                  <Label htmlFor="code">Require the room code or QR</Label>
                  <p className="text-xs text-muted-foreground">
                    The proof of presence; the room&apos;s location check alone can be faked.
                  </p>
                </div>
                <Switch id="code" checked={d.requireCode} onCheckedChange={(v) => set({ requireCode: v })} disabled={!canEdit} />
              </div>
            </div>
          </fieldset>
          {err.value && (
            <p role="alert" className="text-sm text-destructive">
              {err.value}
            </p>
          )}
          {canEdit && (
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save settings
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ── Bell schedule ───────────────────────────────────────────────────────────

interface PeriodDraft {
  id: string | null;
  name: string;
  position: number;
  /** weekday → [start, end] as HH:MM; empty strings = not that day. */
  times: Record<number, [string, string]>;
}

function PeriodsCard({
  periods,
  schoolDays,
  canEdit,
  onSaved,
}: {
  periods: Period[];
  schoolDays: number[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  useSignals();
  const draft = useSignal<PeriodDraft | null>(null);
  const saving = useSignal(false);
  const err = useSignal<string | null>(null);

  function open(p: Period | null) {
    err.value = null;
    const times: Record<number, [string, string]> = {};
    for (const w of WEEKDAYS) times[w] = ["", ""];
    if (p) for (const t of p.times) times[t.weekday] = [minutesToTime(t.startMinute), minutesToTime(t.endMinute)];
    else {
      const last = periods[periods.length - 1];
      for (const w of schoolDays) {
        const prev = last?.times.find((t) => t.weekday === w);
        const start = prev ? prev.endMinute : 9 * 60;
        times[w] = [minutesToTime(start), minutesToTime(Math.min(start + 50, 1440))];
      }
    }
    draft.value = {
      id: p?.id ?? null,
      name: p?.name ?? `Period ${periods.length + 1}`,
      position: p?.position ?? periods.length + 1,
      times,
    };
  }

  function copyToAll(from: number) {
    if (!draft.value) return;
    const t = draft.value.times[from];
    const times = { ...draft.value.times };
    for (const w of schoolDays) times[w] = [...t];
    draft.value = { ...draft.value, times };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const d = draft.value;
    if (!d) return;
    const times: { weekday: number; startMinute: number; endMinute: number }[] = [];
    for (const w of WEEKDAYS) {
      const [s, en] = d.times[w];
      if (!s && !en) continue;
      const sm = timeToMinutes(s);
      const em = timeToMinutes(en);
      if (sm === null || em === null || em <= sm) {
        err.value = `${weekdayLabel(w)}: enter a start and a later end (HH:MM), or leave both empty.`;
        return;
      }
      times.push({ weekday: w, startMinute: sm, endMinute: em });
    }
    saving.value = true;
    err.value = null;
    try {
      await api(d.id ? `${PATH}/periods/${d.id}` : `${PATH}/periods`, {
        method: d.id ? "PATCH" : "POST",
        body: { name: d.name.trim(), position: d.position, times },
      });
      toast.success("Period saved");
      draft.value = null;
      await onSaved();
    } catch (e2) {
      err.value = userMessage(e2, "Could not save the period");
    } finally {
      saving.value = false;
    }
  }

  async function remove(p: Period) {
    if (!window.confirm(`Delete ${p.name}? Every course's timetable entries in this period are deleted too.`)) return;
    try {
      await api(`${PATH}/periods/${p.id}`, { method: "DELETE" });
      toast.success("Period deleted");
      await onSaved();
    } catch (e2) {
      toast.error(userMessage(e2, "Could not delete the period"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Bell schedule</CardTitle>
          <CardDescription>Periods and their times; a period can have different times on different days.</CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => open(null)}>
            <Plus className="mr-2 size-4" aria-hidden />
            Add period
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No periods yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Bell schedule</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th scope="col" className="px-3 py-2 font-medium">Period</th>
                  {schoolDays.map((w) => (
                    <th key={w} scope="col" className="px-3 py-2 font-medium">
                      {weekdayLabel(w, true)}
                    </th>
                  ))}
                  {canEdit && <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">{p.name}</th>
                    {schoolDays.map((w) => {
                      const t = p.times.find((x) => x.weekday === w);
                      return (
                        <td key={w} className="px-3 py-2 tabular-nums text-muted-foreground">
                          {t ? timeRange(t.startMinute, t.endMinute) : "–"}
                        </td>
                      );
                    })}
                    {canEdit && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => open(p)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => void remove(p)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {draft.value && (
        <Dialog open onOpenChange={(o) => !o && (draft.value = null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <form onSubmit={save} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{draft.value.id ? "Edit period" : "Add period"}</DialogTitle>
                <DialogDescription>Leave a day&apos;s times empty when the period does not run that day.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="p-name">Name</Label>
                  <Input
                    id="p-name"
                    required
                    maxLength={60}
                    value={draft.value.name}
                    onChange={(e) => (draft.value = { ...draft.value!, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-pos">Order</Label>
                  <Input
                    id="p-pos"
                    type="number"
                    min={0}
                    max={100}
                    value={draft.value.position}
                    onChange={(e) => (draft.value = { ...draft.value!, position: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Times</legend>
                {WEEKDAYS.filter((w) => schoolDays.includes(w) || draft.value!.times[w][0]).map((w) => (
                  <div key={w} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-sm" id={`p-day-${w}`}>{weekdayLabel(w)}</span>
                    <Input
                      type="time"
                      className="w-28"
                      aria-label={`${weekdayLabel(w)} start`}
                      value={draft.value!.times[w][0]}
                      onChange={(e) => {
                        const times = { ...draft.value!.times, [w]: [e.target.value, draft.value!.times[w][1]] as [string, string] };
                        draft.value = { ...draft.value!, times };
                      }}
                    />
                    <span aria-hidden>–</span>
                    <Input
                      type="time"
                      className="w-28"
                      aria-label={`${weekdayLabel(w)} end`}
                      value={draft.value!.times[w][1]}
                      onChange={(e) => {
                        const times = { ...draft.value!.times, [w]: [draft.value!.times[w][0], e.target.value] as [string, string] };
                        draft.value = { ...draft.value!, times };
                      }}
                    />
                    <Button type="button" size="sm" variant="ghost" onClick={() => copyToAll(w)}>
                      Copy to all days
                    </Button>
                  </div>
                ))}
              </fieldset>
              {err.value && (
                <p role="alert" className="text-sm text-destructive">
                  {err.value}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => (draft.value = null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving.value}>
                  {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ── Rooms ───────────────────────────────────────────────────────────────────

interface RoomDraft {
  id: string | null;
  name: string;
  latitude: string;
  longitude: string;
  radiusM: string;
}

function RoomsCard({ rooms, canEdit, onSaved }: { rooms: Room[]; canEdit: boolean; onSaved: () => Promise<void> }) {
  useSignals();
  const draft = useSignal<RoomDraft | null>(null);
  const saving = useSignal(false);
  const locating = useSignal(false);
  const err = useSignal<string | null>(null);

  function open(r: Room | null) {
    err.value = null;
    draft.value = {
      id: r?.id ?? null,
      name: r?.name ?? "",
      latitude: r?.location ? String(r.location.latitude) : "",
      longitude: r?.location ? String(r.location.longitude) : "",
      radiusM: r?.location ? String(r.location.radiusM) : "50",
    };
  }

  async function here() {
    locating.value = true;
    try {
      const p = await getCurrentPosition();
      draft.value = {
        ...draft.value!,
        latitude: p.latitude.toFixed(6),
        longitude: p.longitude.toFixed(6),
      };
      if (p.accuracy > 50) toast.message(`Location is accurate to about ${Math.round(p.accuracy)} m`);
    } catch (e2) {
      toast.error(userMessage(e2, "Could not get your location"));
    } finally {
      locating.value = false;
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const d = draft.value;
    if (!d) return;
    const hasLoc = d.latitude.trim() !== "" || d.longitude.trim() !== "";
    const location = hasLoc
      ? { latitude: Number(d.latitude), longitude: Number(d.longitude), radiusM: Number(d.radiusM) || 50 }
      : null;
    if (location && (Number.isNaN(location.latitude) || Number.isNaN(location.longitude))) {
      err.value = "Enter both latitude and longitude, or neither.";
      return;
    }
    saving.value = true;
    err.value = null;
    try {
      await api(d.id ? `${PATH}/rooms/${d.id}` : `${PATH}/rooms`, {
        method: d.id ? "PATCH" : "POST",
        body: { name: d.name.trim(), location },
      });
      toast.success("Room saved");
      draft.value = null;
      await onSaved();
    } catch (e2) {
      err.value = userMessage(e2, "Could not save the room");
    } finally {
      saving.value = false;
    }
  }

  async function remove(r: Room) {
    if (!window.confirm(`Delete ${r.name}? Periods in this room keep running without a room.`)) return;
    try {
      await api(`${PATH}/rooms/${r.id}`, { method: "DELETE" });
      toast.success("Room deleted");
      await onSaved();
    } catch (e2) {
      toast.error(userMessage(e2, "Could not delete the room"));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Rooms</CardTitle>
          <CardDescription>
            A saved location is used for the check-in location check of automatic sessions. A teacher sharing their live position still overrides it.
          </CardDescription>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => open(null)}>
            <Plus className="mr-2 size-4" aria-hidden />
            Add room
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rooms yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.location
                      ? `Location saved · within ${r.location.radiusM} m`
                      : "No location: automatic sessions skip the location check"}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => open(r)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {draft.value && (
        <Dialog open onOpenChange={(o) => !o && (draft.value = null)}>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={save} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{draft.value.id ? "Edit room" : "Add room"}</DialogTitle>
                <DialogDescription>
                  Stand in the room and use your current position, or enter coordinates. Leave them empty for no location check.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="r-name">Name</Label>
                <Input
                  id="r-name"
                  required
                  maxLength={100}
                  value={draft.value.name}
                  onChange={(e) => (draft.value = { ...draft.value!, name: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="r-lat">Latitude</Label>
                  <Input
                    id="r-lat"
                    inputMode="decimal"
                    value={draft.value.latitude}
                    onChange={(e) => (draft.value = { ...draft.value!, latitude: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-lng">Longitude</Label>
                  <Input
                    id="r-lng"
                    inputMode="decimal"
                    value={draft.value.longitude}
                    onChange={(e) => (draft.value = { ...draft.value!, longitude: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="r-radius">Radius (m)</Label>
                  <Input
                    id="r-radius"
                    type="number"
                    min={10}
                    max={1000}
                    value={draft.value.radiusM}
                    onChange={(e) => (draft.value = { ...draft.value!, radiusM: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void here()} disabled={locating.value}>
                  {locating.value ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <LocateFixed className="mr-2 size-4" aria-hidden />
                  )}
                  Use my current position
                </Button>
                {(draft.value.latitude || draft.value.longitude) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => (draft.value = { ...draft.value!, latitude: "", longitude: "" })}
                  >
                    Clear location
                  </Button>
                )}
              </div>
              {err.value && (
                <p role="alert" className="text-sm text-destructive">
                  {err.value}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => (draft.value = null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving.value}>
                  {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ── Closures ────────────────────────────────────────────────────────────────

function ClosuresCard({
  setup,
  canEdit,
  onSaved,
}: {
  setup: TimetableSetup;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  useSignals();
  const name = useSignal("");
  const start = useSignal("");
  const end = useSignal("");
  const saving = useSignal(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    saving.value = true;
    try {
      await api(`${PATH}/closures`, {
        method: "POST",
        body: { name: name.value.trim(), startDate: start.value, endDate: end.value || start.value },
      });
      toast.success("Closure added");
      name.value = "";
      start.value = "";
      end.value = "";
      await onSaved();
    } catch (e2) {
      toast.error(userMessage(e2, "Could not add the closure"));
    } finally {
      saving.value = false;
    }
  }

  async function remove(id: string) {
    try {
      await api(`${PATH}/closures/${id}`, { method: "DELETE" });
      await onSaved();
    } catch (e2) {
      toast.error(userMessage(e2, "Could not delete the closure"));
    }
  }

  const upcoming = setup.closures.filter((c) => c.endDate >= setup.today);
  const past = setup.closures.length - upcoming.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays and closures</CardTitle>
        <CardDescription>
          Nothing is scheduled on these days, no attendance opens, and a rotating cycle does not advance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming closures{past ? ` (${past} past)` : ""}.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {upcoming.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.startDate === c.endDate
                      ? formatDay(c.startDate, { year: true })
                      : `${formatDay(c.startDate)} – ${formatDay(c.endDate, { year: true })}`}
                  </p>
                </div>
                {canEdit && (
                  <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => void remove(c.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form onSubmit={add} className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" required maxLength={100} value={name.value} onChange={(e) => (name.value = e.target.value)} placeholder="Half term" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-start">First day</Label>
              <Input id="c-start" type="date" required value={start.value} onChange={(e) => (start.value = e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Last day</Label>
              <Input id="c-end" type="date" min={start.value || undefined} value={end.value} onChange={(e) => (end.value = e.target.value)} />
            </div>
            <Button type="submit" disabled={saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ── Cycle preview ───────────────────────────────────────────────────────────

function CycleCard({ today }: { today: string }) {
  useSignals();
  const preview = useSignal<CyclePreview | null>(null);
  useEffect(() => {
    api<CyclePreview>(`${PATH}/cycle?from=${today}`)
      .then((p) => (preview.value = p))
      .catch(() => (preview.value = null));
  }, [today, preview]);

  if (!preview.value) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next four weeks of the cycle</CardTitle>
        <CardDescription>Check the rotation after saving the settings or adding a closure.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {preview.value.days.map((d) => (
            <li
              key={d.date}
              className={
                d.schoolDay
                  ? "rounded-md border px-2 py-1.5 text-sm"
                  : "rounded-md border border-dashed px-2 py-1.5 text-sm text-muted-foreground"
              }
            >
              <span className="block text-xs">{formatDay(d.date)}</span>
              <span className="font-medium">
                {d.cycleDay ? `Day ${d.cycleDay}` : d.closed ? "Closed" : "No school"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
