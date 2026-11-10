"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, Play, PlugZap, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { downloadFromUrl } from "@/lib/download";
import { isFeatureDisabledError } from "@/lib/features";
import { listOrganisationSchools, type OrganisationSchool } from "@/lib/organisation";
import { ORGANISATION_PATH } from "@/lib/routing";
import {
  countAction,
  listRuns,
  runApi,
  runIsBusy,
  sourceApi,
  startDryRun,
  STATUS_LABELS,
  uploadRosterFiles,
  type RosterRun,
  type RosterSettings,
  type RosterSource,
} from "@/lib/rostering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrgHeader } from "../../_components/org-header";

const IGNORE = "__ignore__";

/** One source: run a dry run, map orgs to schools, matching and email options, history. */
export default function RosterSourcePage() {
  useSignals();
  const params = useParams<{ sourceId: string }>();
  const sourceId = params?.sourceId ?? "";
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const source = useSignal<RosterSource | null>(null);
  const runs = useSignal<RosterRun[] | null>(null);
  const schools = useSignal<OrganisationSchool[]>([]);
  const settings = useSignal<RosterSettings | null>(null);
  const schedule = useSignal<{ daily: boolean; autoApply: boolean }>({ daily: false, autoApply: false });
  const files = useSignal<File[]>([]);
  const starting = useSignal(false);
  const saving = useSignal(false);
  const secret = useSignal("");
  const testResult = useSignal<{ ok: boolean; message: string } | null>(null);
  const testing = useSignal(false);
  const off = useSignal(false);

  const load = useCallback(() => {
    api<RosterSource>(sourceApi(sourceId))
      .then((s) => {
        source.value = s;
        settings.value = s.settings;
        schedule.value = { daily: s.schedule === "daily", autoApply: s.autoApply };
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) off.value = true;
        else toast.error(userMessage(err, "Failed to load the source"));
      });
    listRuns(sourceId)
      .then((r) => (runs.value = r))
      .catch(() => (runs.value = []));
  }, [sourceId, source, settings, schedule, off, runs]);
  useEffect(load, [load]);
  useEffect(() => {
    listOrganisationSchools("", "active")
      .then((s) => (schools.value = s))
      .catch(() => (schools.value = []));
  }, [schools]);

  // Poll while the newest run is busy.
  const busy = runs.value?.[0] && runIsBusy(runs.value[0].status);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () =>
        listRuns(sourceId)
          .then((r) => (runs.value = r))
          .catch(() => undefined),
      2500,
    );
    return () => clearInterval(t);
  }, [busy, sourceId, runs]);

  async function dryRun() {
    if (!source.value) return;
    starting.value = true;
    try {
      const uploads = source.value.kind === "csv" ? await uploadRosterFiles(sourceId, files.value) : undefined;
      const run = await startDryRun(sourceId, uploads);
      files.value = [];
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Dry run started");
      router.push(`${ORGANISATION_PATH}/rostering/${sourceId}/runs/${run.id}`);
    } catch (err) {
      toast.error(userMessage(err, "Failed to start the dry run"));
    } finally {
      starting.value = false;
    }
  }

  async function saveSettings() {
    if (!settings.value || !source.value) return;
    saving.value = true;
    try {
      const updated = await api<RosterSource>(sourceApi(sourceId), {
        method: "PATCH",
        stepUp: !!secret.value,
        body: {
          settings: settings.value,
          ...(source.value.kind === "oneroster_api"
            ? { schedule: schedule.value.daily ? "daily" : "off", autoApply: schedule.value.autoApply }
            : {}),
          ...(secret.value ? { clientSecret: secret.value } : {}),
        },
      });
      source.value = updated;
      settings.value = updated.settings;
      secret.value = "";
      toast.success("Saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      saving.value = false;
    }
  }

  async function testConnection() {
    testing.value = true;
    try {
      testResult.value = await api<{ ok: boolean; message: string }>(`${sourceApi(sourceId)}/test`, { method: "POST" });
    } catch (err) {
      testResult.value = { ok: false, message: userMessage(err, "The test could not run") };
    } finally {
      testing.value = false;
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Delete this source? Its sync history and its record of which GradeBook records came from it are removed. Students, staff and courses it created stay.",
      )
    )
      return;
    try {
      await api(sourceApi(sourceId), { method: "DELETE", stepUp: true });
      toast.success("Source deleted");
      router.push(`${ORGANISATION_PATH}/rostering`);
    } catch (err) {
      toast.error(userMessage(err, "Failed to delete the source"));
    }
  }

  async function errorsCsv(runId: string) {
    try {
      await downloadFromUrl(`${runApi(sourceId, runId)}/errors.csv`, "rostering-errors.csv");
    } catch (err) {
      toast.error(userMessage(err, "Failed to download the errors"));
    }
  }

  const back = (
    <Link
      href={`${ORGANISATION_PATH}/rostering`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Rostering
    </Link>
  );

  if (off.value) {
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Rostering is turned off.</p>
      </div>
    );
  }
  const current = source.value;
  const currentSettings = settings.value;
  if (!current || !currentSettings) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Orgs the newest dry run found, plus any already mapped.
  const orgs = new Map<string, string>();
  for (const r of runs.value ?? []) for (const o of r.summary.orgs ?? []) if (!orgs.has(o.sourcedId)) orgs.set(o.sourcedId, o.name);
  for (const k of Object.keys(currentSettings.orgMap)) if (!orgs.has(k)) orgs.set(k, k);
  const setOrg = (org: string, value: string) => {
    const next = { ...currentSettings.orgMap };
    if (value === "") delete next[org];
    else next[org] = value === IGNORE ? null : value;
    settings.value = { ...currentSettings, orgMap: next };
  };
  const api_ = current.kind === "oneroster_api";

  return (
    <div className="space-y-6">
      {back}
      <OrgHeader
        title={current.name}
        description={api_ ? `OneRoster 1.2 endpoint · ${current.baseUrl}` : "CSV upload"}
        action={
          <Button variant="outline" onClick={() => void remove()}>
            <Trash2 className="mr-1.5 size-4" /> Delete
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Run a dry run</CardTitle>
          <CardDescription>
            Reads the source and lists what would be created, updated or disabled. Nothing changes
            until you review it and apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!api_ && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-files`}>Files</Label>
              <Input
                id={`${id}-files`}
                ref={fileRef}
                type="file"
                multiple
                accept=".csv,.zip,text/csv,application/zip"
                onChange={(e) => (files.value = Array.from(e.target.files ?? []))}
                aria-describedby={`${id}-files-hint`}
              />
              <p id={`${id}-files-hint`} className="text-xs text-muted-foreground">
                A OneRoster CSV bundle (.zip, or its CSV files), or GradeBook templates (students,
                staff, classes, enrolments). Up to 10 files, 50 MB each. A file you leave out is not
                touched: a students-only upload never disables classes.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={starting.value || !!busy || (!api_ && files.value.length === 0)} onClick={() => void dryRun()}>
              {starting.value ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : api_ ? (
                <Play className="mr-1.5 size-4" />
              ) : (
                <Upload className="mr-1.5 size-4" />
              )}
              {api_ ? "Run dry run now" : "Upload and run dry run"}
            </Button>
            {api_ && (
              <Button variant="outline" disabled={testing.value} onClick={() => void testConnection()}>
                {testing.value ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <PlugZap className="mr-1.5 size-4" />}
                Test connection
              </Button>
            )}
          </div>
          {busy && <p role="status" className="text-sm text-muted-foreground">A sync is running…</p>}
          {testResult.value && (
            <p role="status" className={testResult.value.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>
              {testResult.value.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schools</CardTitle>
          <CardDescription>
            Map each school (org) in the source to a GradeBook school, or ignore it. Records of an
            unmapped org wait until you map it. Run a dry run to list the source&apos;s orgs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orgs.size === 0 ? (
            <p className="text-sm text-muted-foreground">No orgs yet: run a dry run first.</p>
          ) : (
            <ul className="space-y-2">
              {[...orgs].map(([org, name]) => {
                const v = currentSettings.orgMap[org];
                return (
                  <li key={org} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{name}</span>{" "}
                      <span className="text-muted-foreground">({org})</span>
                    </span>
                    <NativeSelect
                      value={v === undefined ? "" : v === null ? IGNORE : v}
                      onChange={(e) => setOrg(org, e.target.value)}
                      aria-label={`GradeBook school for ${name}`}
                      className="min-w-56"
                    >
                      <NativeSelectOption value="">Not mapped</NativeSelectOption>
                      <NativeSelectOption value={IGNORE}>Ignore this org</NativeSelectOption>
                      {schools.value.map((s) => (
                        <NativeSelectOption key={s.id} value={s.id}>
                          {s.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matching and emails</CardTitle>
          <CardDescription>
            Records the source sent before are always matched by their source id. New ones can be
            matched to people already in GradeBook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            id={`${id}-number`}
            label="Match students by student number"
            checked={currentSettings.matchBy.studentNumber}
            onChange={(v) => (settings.value = { ...currentSettings, matchBy: { ...currentSettings.matchBy, studentNumber: v } })}
          />
          <ToggleRow
            id={`${id}-email`}
            label="Match students by email"
            hint="Their account email, or the email a roster gave them."
            checked={currentSettings.matchBy.email}
            onChange={(v) => (settings.value = { ...currentSettings, matchBy: { ...currentSettings.matchBy, email: v } })}
          />
          <ToggleRow
            id={`${id}-invites`}
            label="Email staff their invite"
            hint="Staff without an account get an invite; they join as teachers when they first sign in."
            checked={currentSettings.sendStaffInvites}
            onChange={(v) => (settings.value = { ...currentSettings, sendStaffInvites: v })}
          />
          <ToggleRow
            id={`${id}-students`}
            label="Email new students that they can sign in"
            hint="Off by default. Either way a student who signs in with their roster email is linked to their record."
            checked={currentSettings.notifyStudents}
            onChange={(v) => (settings.value = { ...currentSettings, notifyStudents: v })}
          />
          {api_ && (
            <>
              <ToggleRow
                id={`${id}-daily`}
                label="Sync daily"
                hint="A dry run every day."
                checked={schedule.value.daily}
                onChange={(v) => (schedule.value = { ...schedule.value, daily: v })}
              />
              {schedule.value.daily && (
                <ToggleRow
                  id={`${id}-auto`}
                  label="Apply new and changed records automatically"
                  hint="Records to disable always wait for you to confirm."
                  checked={schedule.value.autoApply}
                  onChange={(v) => (schedule.value = { ...schedule.value, autoApply: v })}
                />
              )}
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor={`${id}-secret`}>Replace the client secret</Label>
                <Input
                  id={`${id}-secret`}
                  type="password"
                  autoComplete="new-password"
                  value={secret.value}
                  placeholder={current.secretUnreadable ? "The stored secret can no longer be read: enter it again" : "Leave blank to keep it"}
                  onChange={(e) => (secret.value = e.target.value)}
                />
              </div>
            </>
          )}
          <Button disabled={saving.value} onClick={() => void saveSettings()}>
            {saving.value && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          Sync history
        </h2>
        {!runs.value ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No syncs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Create</TableHead>
                  <TableHead className="text-right">Update</TableHead>
                  <TableHead className="text-right">Disable</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.value.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.trigger === "scheduled" && <span className="ml-1 text-xs text-muted-foreground">(scheduled)</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABELS[r.status]}</Badge>
                      {r.progress.failed > 0 && (
                        <span className="ml-1 text-xs text-destructive">{r.progress.failed} failed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{countAction(r.summary, "create")}</TableCell>
                    <TableCell className="text-right">{countAction(r.summary, "update")}</TableCell>
                    <TableCell className="text-right">{countAction(r.summary, "disable")}</TableCell>
                    <TableCell className="text-right">{(r.summary.errors ?? 0) + r.progress.failed}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="link" size="sm" nativeButton={false} render={<Link href={`${ORGANISATION_PATH}/rostering/${sourceId}/runs/${r.id}`} />}>
                        Review
                      </Button>
                      {(r.summary.errors ?? 0) + r.progress.failed > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => void errorsCsv(r.id)} aria-label="Download errors CSV">
                          <Download className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <Label htmlFor={id} className="font-normal">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
