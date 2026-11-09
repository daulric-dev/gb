"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const params = useParams<{ sourceId: string }>();
  const sourceId = params?.sourceId ?? "";
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<RosterSource | null>(null);
  const [runs, setRuns] = useState<RosterRun[] | null>(null);
  const [schools, setSchools] = useState<OrganisationSchool[]>([]);
  const [settings, setSettings] = useState<RosterSettings | null>(null);
  const [schedule, setSchedule] = useState<{ daily: boolean; autoApply: boolean }>({ daily: false, autoApply: false });
  const [files, setFiles] = useState<File[]>([]);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [off, setOff] = useState(false);

  const load = useCallback(() => {
    api<RosterSource>(sourceApi(sourceId))
      .then((s) => {
        setSource(s);
        setSettings(s.settings);
        setSchedule({ daily: s.schedule === "daily", autoApply: s.autoApply });
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) setOff(true);
        else toast.error(userMessage(err, "Failed to load the source"));
      });
    listRuns(sourceId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [sourceId]);
  useEffect(load, [load]);
  useEffect(() => {
    listOrganisationSchools("", "active").then(setSchools).catch(() => setSchools([]));
  }, []);

  // Poll while the newest run is busy.
  const busy = runs?.[0] && runIsBusy(runs[0].status);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => listRuns(sourceId).then(setRuns).catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [busy, sourceId]);

  async function dryRun() {
    if (!source) return;
    setStarting(true);
    try {
      const uploads = source.kind === "csv" ? await uploadRosterFiles(sourceId, files) : undefined;
      const run = await startDryRun(sourceId, uploads);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Dry run started");
      router.push(`${ORGANISATION_PATH}/rostering/${sourceId}/runs/${run.id}`);
    } catch (err) {
      toast.error(userMessage(err, "Failed to start the dry run"));
    } finally {
      setStarting(false);
    }
  }

  async function saveSettings() {
    if (!settings || !source) return;
    setSaving(true);
    try {
      const updated = await api<RosterSource>(sourceApi(sourceId), {
        method: "PATCH",
        stepUp: !!secret,
        body: {
          settings,
          ...(source.kind === "oneroster_api"
            ? { schedule: schedule.daily ? "daily" : "off", autoApply: schedule.autoApply }
            : {}),
          ...(secret ? { clientSecret: secret } : {}),
        },
      });
      setSource(updated);
      setSettings(updated.settings);
      setSecret("");
      toast.success("Saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      setTestResult(await api<{ ok: boolean; message: string }>(`${sourceApi(sourceId)}/test`, { method: "POST" }));
    } catch (err) {
      setTestResult({ ok: false, message: userMessage(err, "The test could not run") });
    } finally {
      setTesting(false);
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

  if (off) {
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Rostering is turned off.</p>
      </div>
    );
  }
  if (!source || !settings) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Orgs the newest dry run found, plus any already mapped.
  const orgs = new Map<string, string>();
  for (const r of runs ?? []) for (const o of r.summary.orgs ?? []) if (!orgs.has(o.sourcedId)) orgs.set(o.sourcedId, o.name);
  for (const k of Object.keys(settings.orgMap)) if (!orgs.has(k)) orgs.set(k, k);
  const setOrg = (org: string, value: string) => {
    const next = { ...settings.orgMap };
    if (value === "") delete next[org];
    else next[org] = value === IGNORE ? null : value;
    setSettings({ ...settings, orgMap: next });
  };
  const api_ = source.kind === "oneroster_api";

  return (
    <div className="space-y-6">
      {back}
      <OrgHeader
        title={source.name}
        description={api_ ? `OneRoster 1.2 endpoint · ${source.baseUrl}` : "CSV upload"}
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
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
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
            <Button disabled={starting || !!busy || (!api_ && files.length === 0)} onClick={() => void dryRun()}>
              {starting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : api_ ? (
                <Play className="mr-1.5 size-4" />
              ) : (
                <Upload className="mr-1.5 size-4" />
              )}
              {api_ ? "Run dry run now" : "Upload and run dry run"}
            </Button>
            {api_ && (
              <Button variant="outline" disabled={testing} onClick={() => void testConnection()}>
                {testing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <PlugZap className="mr-1.5 size-4" />}
                Test connection
              </Button>
            )}
          </div>
          {busy && <p role="status" className="text-sm text-muted-foreground">A sync is running…</p>}
          {testResult && (
            <p role="status" className={testResult.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>
              {testResult.message}
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
                const v = settings.orgMap[org];
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
                      {schools.map((s) => (
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
            checked={settings.matchBy.studentNumber}
            onChange={(v) => setSettings({ ...settings, matchBy: { ...settings.matchBy, studentNumber: v } })}
          />
          <ToggleRow
            id={`${id}-email`}
            label="Match students by email"
            hint="Their account email, or the email a roster gave them."
            checked={settings.matchBy.email}
            onChange={(v) => setSettings({ ...settings, matchBy: { ...settings.matchBy, email: v } })}
          />
          <ToggleRow
            id={`${id}-invites`}
            label="Email staff their invite"
            hint="Staff without an account get an invite; they join as teachers when they first sign in."
            checked={settings.sendStaffInvites}
            onChange={(v) => setSettings({ ...settings, sendStaffInvites: v })}
          />
          <ToggleRow
            id={`${id}-students`}
            label="Email new students that they can sign in"
            hint="Off by default. Either way a student who signs in with their roster email is linked to their record."
            checked={settings.notifyStudents}
            onChange={(v) => setSettings({ ...settings, notifyStudents: v })}
          />
          {api_ && (
            <>
              <ToggleRow
                id={`${id}-daily`}
                label="Sync daily"
                hint="A dry run every day."
                checked={schedule.daily}
                onChange={(v) => setSchedule({ ...schedule, daily: v })}
              />
              {schedule.daily && (
                <ToggleRow
                  id={`${id}-auto`}
                  label="Apply new and changed records automatically"
                  hint="Records to disable always wait for you to confirm."
                  checked={schedule.autoApply}
                  onChange={(v) => setSchedule({ ...schedule, autoApply: v })}
                />
              )}
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor={`${id}-secret`}>Replace the client secret</Label>
                <Input
                  id={`${id}-secret`}
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  placeholder={source.secretUnreadable ? "The stored secret can no longer be read: enter it again" : "Leave blank to keep it"}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
            </>
          )}
          <Button disabled={saving} onClick={() => void saveSettings()}>
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          Sync history
        </h2>
        {!runs ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.length === 0 ? (
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
                {runs.map((r) => (
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
                      <Button variant="link" size="sm" render={<Link href={`${ORGANISATION_PATH}/rostering/${sourceId}/runs/${r.id}`} />}>
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
