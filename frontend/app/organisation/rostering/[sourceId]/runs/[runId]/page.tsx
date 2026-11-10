"use client";

import { useCallback, useEffect, useId } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import { downloadFromUrl } from "@/lib/download";
import { ORGANISATION_PATH } from "@/lib/routing";
import {
  ACTION_LABELS,
  applyRun,
  countAction,
  diffValue,
  discardRun,
  ENTITY_LABELS,
  fieldLabel,
  getRun,
  listChanges,
  progressPercent,
  runApi,
  runIsBusy,
  STATUS_LABELS,
  type ChangeAction,
  type ChangeFilters,
  type ChangeStatus,
  type RosterChange,
  type RosterEntity,
  type RosterRun,
} from "@/lib/rostering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgHeader } from "../../../../_components/org-header";

const PAGE = 100;

/** Review a dry run's change set, then apply it (disables only when confirmed). */
export default function RosterRunPage() {
  useSignals();
  const params = useParams<{ sourceId: string; runId: string }>();
  const sourceId = params?.sourceId ?? "";
  const runId = params?.runId ?? "";
  const id = useId();
  const run = useSignal<RosterRun | null>(null);
  const filters = useSignal<ChangeFilters>({});
  const search = useSignal("");
  const changes = useSignal<RosterChange[] | null>(null);
  const total = useSignal(0);
  const confirmDisables = useSignal(false);
  const applying = useSignal(false);

  const loadRun = useCallback(
    () =>
      getRun(sourceId, runId)
        .then((r) => (run.value = r))
        .catch((err) => toast.error(userMessage(err, "Failed to load the run"))),
    [sourceId, runId, run],
  );
  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  const busy = run.value ? runIsBusy(run.value.status) : false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void loadRun(), 2000);
    return () => clearInterval(t);
  }, [busy, loadRun]);

  const status = run.value?.status;
  const currentFilters = filters.value;
  const loadChanges = useCallback(
    (offset = 0) => {
      listChanges(sourceId, runId, { ...currentFilters, limit: PAGE, offset })
        .then((page) => {
          total.value = page.total;
          changes.value = offset === 0 ? page.data : [...(changes.value ?? []), ...page.data];
        })
        .catch((err) => toast.error(userMessage(err, "Failed to load the changes")));
    },
    [sourceId, runId, currentFilters, total, changes],
  );
  useEffect(() => {
    if (status && status !== "planning") loadChanges(0);
  }, [status, loadChanges]);

  const currentSearch = search.value;
  useEffect(() => {
    const t = setTimeout(
      () => (filters.value = { ...filters.value, search: currentSearch || undefined }),
      300,
    );
    return () => clearTimeout(t);
  }, [currentSearch, filters]);

  async function apply() {
    if (!run.value) return;
    const disables = countAction(run.value.summary, "disable");
    const msg =
      confirmDisables.value && disables > 0
        ? `Apply the changes, including disabling ${disables} record(s) missing from the source?`
        : "Apply the new and changed records? Records to disable are left as they are.";
    if (!window.confirm(msg)) return;
    applying.value = true;
    try {
      run.value = await applyRun(sourceId, runId, confirmDisables.value);
      toast.success("Applying in the background");
    } catch (err) {
      toast.error(userMessage(err, "Failed to apply"));
    } finally {
      applying.value = false;
    }
  }

  async function discard() {
    if (!window.confirm("Discard this dry run? Nothing was changed.")) return;
    try {
      run.value = await discardRun(sourceId, runId);
    } catch (err) {
      toast.error(userMessage(err, "Failed to discard"));
    }
  }

  async function errorsCsv() {
    try {
      await downloadFromUrl(`${runApi(sourceId, runId)}/errors.csv`, "rostering-errors.csv");
    } catch (err) {
      toast.error(userMessage(err, "Failed to download the errors"));
    }
  }

  const back = (
    <Link
      href={`${ORGANISATION_PATH}/rostering/${sourceId}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Source
    </Link>
  );
  const current = run.value;
  const changeList = changes.value;
  if (!current) {
    return (
      <div className="space-y-4">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const s = current.summary;
  const disables = countAction(s, "disable");
  const errorCount = (s.errors ?? 0) + current.progress.failed;
  const entities = Object.keys(s.counts ?? {}) as RosterEntity[];

  return (
    <div className="space-y-6">
      {back}
      <OrgHeader
        title={current.status === "planned" ? "Review the dry run" : STATUS_LABELS[current.status]}
        description={`Started ${new Date(current.createdAt).toLocaleString()}${current.trigger === "scheduled" ? " (scheduled)" : ""}`}
        action={
          errorCount > 0 && (
            <Button variant="outline" onClick={() => void errorsCsv()}>
              <Download className="mr-1.5 size-4" /> Errors CSV
            </Button>
          )
        }
      />

      {current.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {current.error}
        </p>
      )}

      {current.status === "planning" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading the source and working out the changes…
        </p>
      )}

      {(current.status === "queued" || current.status === "applying" || current.status === "applied") && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex justify-between text-sm">
              <span>
                {current.progress.done} of {current.progress.total} applied
                {current.progress.failed > 0 && <span className="text-destructive"> · {current.progress.failed} failed</span>}
              </span>
              <span>{progressPercent(current)}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Apply progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent(current)}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent(current)}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {current.status !== "planning" && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>
              {s.waiting
                ? `${s.waiting} course role(s) wait for teachers to sign in for the first time; a later sync adds them.`
                : "What applying would change."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {entities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes: GradeBook already matches the source.</p>
            ) : (
              <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {entities.map((e) => (
                  <div key={e} className="rounded-lg border p-3">
                    <dt className="text-sm font-medium">{ENTITY_LABELS[e]}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1 text-xs">
                      {(Object.entries(s.counts?.[e] ?? {}) as [ChangeAction, number][]).map(([a, n]) => (
                        <Badge key={a} variant={a === "error" ? "destructive" : a === "disable" ? "outline" : "secondary"}>
                          {ACTION_LABELS[a]}: {n}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      )}

      {current.status === "planned" && (
        <Card>
          <CardHeader>
            <CardTitle>Apply</CardTitle>
            <CardDescription>
              Runs in the background; you can leave this page. Nothing is ever deleted: disabling
              deactivates a student, archives a course, drops an enrolment or removes a course role.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {disables > 0 && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`${id}-disables`}
                  checked={confirmDisables.value}
                  onCheckedChange={(v) => (confirmDisables.value = v === true)}
                />
                <Label htmlFor={`${id}-disables`} className="font-normal">
                  Also disable the {disables} record(s) missing from the source
                  <span className="block text-xs text-muted-foreground">
                    Left unticked, they stay as they are and the next dry run lists them again.
                  </span>
                </Label>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={applying.value || (s.applicable ?? 0) + (confirmDisables.value ? disables : 0) === 0} onClick={() => void apply()}>
                {applying.value && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                Apply changes
              </Button>
              <Button variant="outline" onClick={() => void discard()}>
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {current.status !== "planning" && (
        <section aria-labelledby="changes-heading" className="space-y-3">
          <h2 id="changes-heading" className="text-lg font-semibold">
            Changes ({total.value})
          </h2>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Record type"
              value={currentFilters.entity ?? ""}
              onChange={(e) => (filters.value = { ...filters.value, entity: (e.target.value || undefined) as RosterEntity | undefined })}
            >
              <NativeSelectOption value="">All records</NativeSelectOption>
              {(Object.keys(ENTITY_LABELS) as RosterEntity[]).map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {ENTITY_LABELS[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Change"
              value={currentFilters.action ?? ""}
              onChange={(e) => (filters.value = { ...filters.value, action: (e.target.value || undefined) as ChangeAction | undefined })}
            >
              <NativeSelectOption value="">All changes</NativeSelectOption>
              {(Object.keys(ACTION_LABELS) as ChangeAction[]).map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {ACTION_LABELS[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {current.status !== "planned" && (
              <NativeSelect
                aria-label="Apply status"
                value={currentFilters.status ?? ""}
                onChange={(e) => (filters.value = { ...filters.value, status: (e.target.value || undefined) as ChangeStatus | undefined })}
              >
                <NativeSelectOption value="">Any status</NativeSelectOption>
                <NativeSelectOption value="applied">Applied</NativeSelectOption>
                <NativeSelectOption value="failed">Failed</NativeSelectOption>
                <NativeSelectOption value="skipped">Skipped</NativeSelectOption>
                <NativeSelectOption value="pending">Pending</NativeSelectOption>
              </NativeSelect>
            )}
            <Input
              type="search"
              aria-label="Search by name or source id"
              placeholder="Search by name or source id"
              className="max-w-xs"
              value={search.value}
              onChange={(e) => (search.value = e.target.value)}
            />
          </div>

          {!changeList ? (
            <Skeleton className="h-40 w-full" />
          ) : changeList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes match.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {changeList.map((c) => (
                <li key={c.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={c.action === "error" ? "destructive" : c.action === "disable" ? "outline" : "secondary"}>
                      {ACTION_LABELS[c.action]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{ENTITY_LABELS[c.entity]}</span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-xs text-muted-foreground">{c.sourcedId}</span>
                    {current.status !== "planned" && c.action !== "error" && (
                      <span className={c.status === "failed" ? "ml-auto text-xs text-destructive" : "ml-auto text-xs text-muted-foreground"}>
                        {c.status}
                      </span>
                    )}
                  </div>
                  {Object.keys(c.diff).length > 0 && (
                    <dl className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[max-content_1fr]">
                      {Object.entries(c.diff).map(([field, d]) => (
                        <div key={field} className="contents">
                          <dt className="text-muted-foreground">{fieldLabel(field)}</dt>
                          <dd>
                            {c.action === "create" ? (
                              diffValue(d.to)
                            ) : (
                              <>
                                <span className="line-through decoration-muted-foreground/60">{diffValue(d.from)}</span>
                                <span aria-hidden> → </span>
                                <span className="sr-only"> changes to </span>
                                {diffValue(d.to)}
                              </>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {c.action === "update" && Object.keys(c.diff).length === 0 && (
                    <p className="text-sm text-muted-foreground">Linked to the existing record; nothing changes.</p>
                  )}
                  {[...c.errors, c.applyError].filter(Boolean).map((e) => (
                    <p key={e} className="text-sm text-destructive">
                      {e}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {changeList && changeList.length < total.value && (
            <Button variant="outline" onClick={() => loadChanges(changeList.length)}>
              Show more
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
