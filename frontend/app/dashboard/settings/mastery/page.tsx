"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Archive, ArchiveRestore, FileUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  CALCULATION_LABEL,
  defaultBands,
  nestOutcomes,
  scaleError,
  type Calculation,
  type ImportResult,
  type MasteryScale,
  type OutcomeSet,
  type OutcomeSetSummary,
  type ScoreBand,
} from "@/lib/mastery";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LevelBadge } from "@/components/mastery/mastery-ui";
import { cn } from "@/lib/utils";

interface ScaleDraft {
  levels: string[];
  masteryThreshold: number;
  calculation: Calculation;
  decayWeight: number;
  minEvidence: number;
  scoreBands: ScoreBand[];
  reportCardSection: boolean;
}

const toDraft = (s: MasteryScale): ScaleDraft => ({
  levels: s.levels.map((l) => l.label),
  masteryThreshold: s.masteryThreshold,
  calculation: s.calculation,
  decayWeight: s.decayWeight,
  minEvidence: s.minEvidence,
  scoreBands: s.scoreBands,
  reportCardSection: s.reportCardSection,
});

/** School mastery setup: the proficiency scale and outcome sets (school:update to change). */
export default function MasterySettingsPage() {
  useSignals();
  const can = useOptionalCan();
  const canEdit = can("school", "update");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mastery &amp; outcomes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Learning outcomes tracked alongside the points gradebook. Teachers link outcomes to activities, rubric rows
          and quiz questions in each course; marks become evidence automatically.
        </p>
      </div>
      <ScaleCard canEdit={canEdit} />
      <OutcomeSetsCard canEdit={canEdit} />
    </div>
  );
}

function ScaleCard({ canEdit }: { canEdit: boolean }) {
  useSignals();
  const draft = useSignal<ScaleDraft | null>(null);
  const saving = useSignal(false);

  useEffect(() => {
    api<MasteryScale>("/mastery/settings")
      .then((s) => (draft.value = toDraft(s)))
      .catch((err) => toast.error(userMessage(err, "Failed to load the scale")));
  }, [draft]);

  const d = draft.value;
  if (!d) return <Skeleton className="h-64 w-full" />;
  const error = scaleError(d);
  const preview: MasteryScale = { ...d, levels: d.levels.map((label, i) => ({ value: i + 1, label })) };
  const patch = (p: Partial<ScaleDraft>) => (draft.value = { ...d, ...p });

  function setCount(n: number) {
    const levels = Array.from({ length: n }, (_, i) => d!.levels[i] ?? `Level ${i + 1}`);
    patch({ levels, scoreBands: defaultBands(n), masteryThreshold: Math.min(d!.masteryThreshold, n) });
  }

  async function save() {
    if (error) return;
    saving.value = true;
    try {
      const out = await api<MasteryScale>("/mastery/settings", { method: "PUT", body: d });
      draft.value = toDraft(out);
      toast.success("Scale saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save the scale"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proficiency scale</CardTitle>
        <CardDescription>
          The levels evidence is measured on and how mastery is worked out. Changing it applies to all past evidence.
          Late penalties never affect mastery: it measures learning, not punctuality.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="text-sm font-medium">Levels (lowest first)</legend>
          <div className="flex items-center gap-2">
            <Label htmlFor="level-count" className="text-sm font-normal">
              Number of levels
            </Label>
            <NativeSelect id="level-count" className="w-20" value={String(d.levels.length)} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                <NativeSelectOption key={n} value={String(n)}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.levels.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <Label htmlFor={`level-${i}`} className="w-6 shrink-0 text-right text-sm font-normal">
                  {i + 1}
                </Label>
                <Input
                  id={`level-${i}`}
                  value={label}
                  maxLength={40}
                  onChange={(e) => patch({ levels: d.levels.map((l, j) => (j === i ? e.target.value : l)) })}
                />
                <LevelBadge level={i + 1} label={label || "-"} scale={preview} className="hidden sm:inline-flex" />
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2" aria-disabled={!canEdit}>
          <div className="space-y-1.5">
            <Label htmlFor="mastery-threshold">Mastered at</Label>
            <NativeSelect
              id="mastery-threshold"
              disabled={!canEdit}
              value={String(d.masteryThreshold)}
              onChange={(e) => patch({ masteryThreshold: Number(e.target.value) })}
            >
              {d.levels.map((l, i) => (
                <NativeSelectOption key={i} value={String(i + 1)}>
                  {i + 1} {l} or above
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calculation">Calculation</Label>
            <NativeSelect
              id="calculation"
              disabled={!canEdit}
              value={d.calculation}
              onChange={(e) => patch({ calculation: e.target.value as Calculation })}
            >
              {(Object.keys(CALCULATION_LABEL) as Calculation[]).map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {CALCULATION_LABEL[c]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {d.calculation === "decaying_average" && (
            <div className="space-y-1.5">
              <Label htmlFor="decay-weight">Weight of the newest evidence (%)</Label>
              <Input
                id="decay-weight"
                inputMode="numeric"
                disabled={!canEdit}
                value={String(Math.round(d.decayWeight * 100))}
                onChange={(e) => patch({ decayWeight: Number(e.target.value.replace(/\D/g, "").slice(0, 2) || "0") / 100 })}
              />
              <p className="text-xs text-muted-foreground">
                Each new piece counts this much; everything before it the rest. 65% is a common choice.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="min-evidence">Evidence needed before &ldquo;mastered&rdquo;</Label>
            <Input
              id="min-evidence"
              inputMode="numeric"
              disabled={!canEdit}
              value={String(d.minEvidence)}
              onChange={(e) => patch({ minEvidence: Number(e.target.value.replace(/\D/g, "").slice(0, 2) || "0") })}
            />
          </div>
        </div>

        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="text-sm font-medium">Score bands</legend>
          <p className="text-xs text-muted-foreground">
            An activity&apos;s percent (before any late penalty) becomes the level of the band it reaches. Rubric rows
            use the chosen rating&apos;s place among the row&apos;s ratings instead.
          </p>
          <ul className="space-y-2">
            {d.scoreBands.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <Label htmlFor={`band-${i}`} className="font-normal">
                  From
                </Label>
                <Input
                  id={`band-${i}`}
                  className="w-20"
                  inputMode="decimal"
                  disabled={i === 0 || !canEdit}
                  value={String(b.minPercent)}
                  onChange={(e) =>
                    patch({
                      scoreBands: d.scoreBands.map((x, j) => (j === i ? { ...x, minPercent: Number(e.target.value) || 0 } : x)),
                    })
                  }
                />
                <span aria-hidden>% →</span>
                <LevelBadge level={b.level} label={d.levels[b.level - 1] ?? `Level ${b.level}`} scale={preview} />
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <Label htmlFor="report-section">Show an outcomes section on report cards</Label>
          <Switch
            id="report-section"
            disabled={!canEdit}
            checked={d.reportCardSection}
            onCheckedChange={(on) => patch({ reportCardSection: on })}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {canEdit && (
          <Button onClick={() => void save()} disabled={!!error || saving.value}>
            {saving.value ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            Save scale
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeSetsCard({ canEdit }: { canEdit: boolean }) {
  useSignals();
  const sets = useSignal<OutcomeSetSummary[] | null>(null);
  const openId = useSignal<string | null>(null);
  const open = useSignal<OutcomeSet | null>(null);
  const newTitle = useSignal("");
  const csv = useSignal("");
  const importTitle = useSignal("");
  const importInto = useSignal("");
  const preview = useSignal<ImportResult | null>(null);
  const busy = useSignal(false);
  const outcomeCode = useSignal("");
  const outcomeTitle = useSignal("");

  async function loadSets() {
    try {
      sets.value = await api<OutcomeSetSummary[]>("/mastery/outcome-sets?includeArchived=true");
    } catch (err) {
      toast.error(userMessage(err, "Failed to load outcome sets"));
    }
  }
  async function loadSet(id: string) {
    openId.value = id;
    try {
      open.value = await api<OutcomeSet>(`/mastery/outcome-sets/${id}`);
    } catch (err) {
      toast.error(userMessage(err, "Failed to load the set"));
    }
  }

  useEffect(() => {
    void loadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    busy.value = true;
    try {
      await action();
      toast.success(done);
      await loadSets();
      if (openId.value) await loadSet(openId.value);
    } catch (err) {
      toast.error(userMessage(err, failed));
    } finally {
      busy.value = false;
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    csv.value = await file.text();
    preview.value = null;
  }

  async function checkImport(dryRun: boolean) {
    busy.value = true;
    try {
      const body = {
        csv: csv.value,
        dryRun,
        ...(importInto.value ? { setId: importInto.value } : { title: importTitle.value.trim() }),
      };
      const out = await api<ImportResult>("/mastery/outcome-sets/import", { method: "POST", body });
      preview.value = out;
      if (!dryRun) {
        toast.success(`Imported: ${out.created} added, ${out.updated} updated`);
        csv.value = "";
        preview.value = null;
        await loadSets();
        if (out.set) await loadSet(out.set.id);
      }
    } catch (err) {
      toast.error(userMessage(err, "Could not import"));
    } finally {
      busy.value = false;
    }
  }

  const set = open.value;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome sets</CardTitle>
        <CardDescription>
          School-wide frameworks (for example a national curriculum) with nested outcomes. Outcomes with evidence can
          be archived but never deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!sets.value ? (
          <Skeleton className="h-24 w-full" />
        ) : sets.value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outcome sets yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sets.value.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <button
                  type="button"
                  className={cn("text-left underline-offset-2 hover:underline", s.archived && "text-muted-foreground")}
                  aria-expanded={openId.value === s.id}
                  onClick={() => void loadSet(s.id)}
                >
                  <span className="font-medium">{s.title}</span> · {s.outcomeCount} outcomes
                  {s.archived && " · archived"}
                </button>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy.value}
                    aria-label={`${s.archived ? "Restore" : "Archive"} ${s.title}`}
                    onClick={() =>
                      void run(
                        () => api(`/mastery/outcome-sets/${s.id}`, { method: "PATCH", body: { archived: !s.archived } }),
                        s.archived ? "Restored" : "Archived",
                        "Could not update the set",
                      )
                    }
                  >
                    {s.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {set && (
          <section aria-labelledby="open-set" className="space-y-3 rounded-lg border p-3">
            <h2 id="open-set" className="text-base font-semibold">
              {set.title}
            </h2>
            {set.outcomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outcomes in this set yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {nestOutcomes(set.outcomes).map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                    style={{ paddingLeft: `${o.depth * 1.25}rem` }}
                  >
                    <span className={cn(o.archived && "text-muted-foreground line-through")}>
                      <span className="font-mono text-xs">{o.code}</span> {o.title}
                      {o.archived && <span className="sr-only"> (archived)</span>}
                      {o.evidenceCount > 0 && <span className="text-xs text-muted-foreground"> · {o.evidenceCount} evidence</span>}
                    </span>
                    {canEdit && (
                      <span className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy.value}
                          aria-label={`${o.archived ? "Restore" : "Archive"} ${o.code}`}
                          onClick={() =>
                            void run(
                              () =>
                                api(`/mastery/outcome-sets/${set.id}/outcomes/${o.id}`, {
                                  method: "PATCH",
                                  body: { archived: !o.archived },
                                }),
                              o.archived ? "Restored" : "Archived",
                              "Could not update the outcome",
                            )
                          }
                        >
                          {o.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                        </Button>
                        {o.evidenceCount === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy.value}
                            aria-label={`Delete ${o.code}`}
                            onClick={() =>
                              void run(
                                () => api(`/mastery/outcome-sets/${set.id}/outcomes/${o.id}`, { method: "DELETE" }),
                                "Deleted",
                                "Could not delete the outcome",
                              )
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form
                className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      api(`/mastery/outcome-sets/${set.id}/outcomes`, {
                        method: "POST",
                        body: { code: outcomeCode.value.trim(), title: outcomeTitle.value.trim(), position: set.outcomes.length },
                      }),
                    "Outcome added",
                    "Could not add the outcome",
                  ).then(() => {
                    outcomeCode.value = "";
                    outcomeTitle.value = "";
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="set-outcome-code">Code</Label>
                  <Input id="set-outcome-code" maxLength={64} value={outcomeCode.value} onChange={(e) => (outcomeCode.value = e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="set-outcome-title">Outcome</Label>
                  <Input id="set-outcome-title" maxLength={500} value={outcomeTitle.value} onChange={(e) => (outcomeTitle.value = e.target.value)} />
                </div>
                <Button type="submit" disabled={busy.value || !outcomeCode.value.trim() || !outcomeTitle.value.trim()}>
                  <Plus className="mr-2 size-4" aria-hidden />
                  Add
                </Button>
              </form>
            )}
          </section>
        )}

        {canEdit && (
          <>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => api("/mastery/outcome-sets", { method: "POST", body: { title: newTitle.value.trim() } }),
                  "Set created",
                  "Could not create the set",
                ).then(() => (newTitle.value = ""));
              }}
            >
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="new-set">New empty set</Label>
                <Input id="new-set" maxLength={200} value={newTitle.value} onChange={(e) => (newTitle.value = e.target.value)} />
              </div>
              <Button type="submit" variant="outline" disabled={busy.value || !newTitle.value.trim()}>
                <Plus className="mr-2 size-4" aria-hidden />
                Create
              </Button>
            </form>

            <section aria-labelledby="import-heading" className="space-y-3 border-t pt-4">
              <h2 id="import-heading" className="text-base font-semibold">
                Import from CSV
              </h2>
              <p className="text-xs text-muted-foreground">
                Columns: <code>code</code>, <code>title</code>, and optionally <code>description</code>,{" "}
                <code>subject</code>, <code>grade_level</code>, <code>parent_code</code>. Importing into an existing set
                updates outcomes with the same code.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="import-into">Import into</Label>
                  <NativeSelect id="import-into" value={importInto.value} onChange={(e) => (importInto.value = e.target.value)}>
                    <NativeSelectOption value="">A new set</NativeSelectOption>
                    {(sets.value ?? []).map((s) => (
                      <NativeSelectOption key={s.id} value={s.id}>
                        {s.title}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                {!importInto.value && (
                  <div className="space-y-1.5">
                    <Label htmlFor="import-title">New set title</Label>
                    <Input id="import-title" maxLength={200} value={importTitle.value} onChange={(e) => (importTitle.value = e.target.value)} />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-file">CSV file</Label>
                <Input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-csv">Or paste the CSV</Label>
                <Textarea
                  id="import-csv"
                  rows={4}
                  className="font-mono text-xs"
                  value={csv.value}
                  onChange={(e) => {
                    csv.value = e.target.value;
                    preview.value = null;
                  }}
                />
              </div>
              {preview.value && (
                <div role="status" className="rounded-md border p-2 text-sm">
                  {preview.value.errors.length === 0 ? (
                    <p>
                      Ready: {preview.value.created} to add, {preview.value.updated} to update.
                    </p>
                  ) : (
                    <ul className="list-inside list-disc text-destructive">
                      {preview.value.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>
                          Line {e.line}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy.value || !csv.value.trim()} onClick={() => void checkImport(true)}>
                  Check file
                </Button>
                <Button
                  disabled={busy.value || !csv.value.trim() || !preview.value || preview.value.errors.length > 0}
                  onClick={() => void checkImport(false)}
                >
                  <FileUp className="mr-2 size-4" aria-hidden />
                  Import
                </Button>
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
