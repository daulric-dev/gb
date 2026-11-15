"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AlertTriangle, Download, FileArchive, Loader2, Trash2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  canRequestNew,
  categorySummary,
  deleteExport,
  downloadExport,
  exportPhase,
  exportStatusText,
  formatBytes,
  includedText,
  listExports,
  pollDelayMs,
  requestExport,
  shouldPoll,
  staffExportWarnings,
  type DataExport,
  type DataExportKind,
  type DataExportTarget,
} from "@/lib/data-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PHASE_BADGE = {
  preparing: { label: "Preparing", variant: "secondary" },
  ready: { label: "Ready", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  expired: { label: "Expired", variant: "outline" },
} as const;

/** How many past downloads the card lists. */
const SHOWN = 5;

function targetOf(kind: DataExportKind, studentId: string | undefined): DataExportTarget {
  if (kind === "self" || !studentId) return { kind: "self" };
  return { kind, studentId };
}

/** Open the signed URL; an anchor is never popup-blocked after the step-up dialog. */
function openUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * "Download your data" (subject access / data portability, backend
 * src/data-export): ask for a ZIP, watch it being prepared, download it while
 * it lasts, delete it early. Asking and downloading need "Confirm it's you".
 *
 * `kind`: "self" (your own account), "student" (staff, `student:export`) or
 * "child" (a parent, for a linked child). `subjectName` is the student's
 * name for the other two.
 */
export function DataExportCard({
  kind,
  studentId,
  subjectName,
  title,
}: {
  kind: DataExportKind;
  studentId?: string;
  subjectName?: string | null;
  title?: string;
}) {
  useSignals();
  const rows = useSignal<DataExport[] | null>(null);
  /** "request", or the id of the export being downloaded/deleted. */
  const busy = useSignal<string | null>(null);
  const pollAttempt = useSignal(0);

  const load = useCallback(async () => {
    try {
      rows.value = await listExports(targetOf(kind, studentId));
    } catch {
      // Keep what we had; a first failure shows the empty state.
      if (rows.value === null) rows.value = [];
    }
  }, [kind, studentId, rows]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while something is being prepared, backing off.
  const polling = rows.value ? shouldPoll(rows.value) : false;
  const attempt = pollAttempt.value;
  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => {
      void load().then(() => (pollAttempt.value = attempt + 1));
    }, pollDelayMs(attempt));
    return () => clearTimeout(timer);
  }, [polling, attempt, load, pollAttempt]);

  async function ask() {
    busy.value = "request";
    try {
      const created = await requestExport(targetOf(kind, studentId));
      rows.value = [created, ...(rows.value ?? []).filter((e) => e.id !== created.id)];
      pollAttempt.value = 0;
      toast.success("Download requested. We'll email you when it's ready.");
    } catch (err) {
      toast.error(userMessage(err, "Could not ask for a download"));
    } finally {
      busy.value = null;
    }
  }

  async function download(e: DataExport) {
    busy.value = e.id;
    try {
      const { url, filename } = await downloadExport(e.id);
      openUrl(url, filename);
      void load();
    } catch (err) {
      toast.error(userMessage(err, "Could not download it"));
      void load();
    } finally {
      busy.value = null;
    }
  }

  async function remove(e: DataExport) {
    if (!window.confirm("Delete this download? You can ask for a new one at any time.")) return;
    busy.value = e.id;
    try {
      await deleteExport(e.id);
      rows.value = (rows.value ?? []).filter((r) => r.id !== e.id);
      toast.success("Download deleted");
    } catch (err) {
      toast.error(userMessage(err, "Could not delete it"));
    } finally {
      busy.value = null;
    }
  }

  const list = rows.value;
  const now = new Date();
  const heading =
    title ??
    (kind === "self" ? (
      "Download your data"
    ) : (
      <>
        Download <span translate="no">{subjectName || "the student"}</span>&apos;s data
      </>
    ));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileArchive className="size-4" aria-hidden="true" />
          {heading}
        </CardTitle>
        <CardDescription className="space-y-2">
          <span className="block">{includedText(kind)}</span>
          <span className="block">
            It is prepared as a ZIP of JSON files with a README. We email you when it is ready;
            it can be downloaded for a limited time (usually 24 hours) and is then deleted.
            You will be asked to confirm it&apos;s you.
          </span>
          {kind === "student" && (
            <span className="block">
              Only you can download it. Check it before sending it on: the student&apos;s own sent
              chat messages, uploaded files, sign-in sessions and devices are included.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={() => void ask()}
          disabled={busy.value !== null || list === null || !canRequestNew(list)}
        >
          {busy.value === "request" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Ask for a download
        </Button>

        {list === null ? (
          <Skeleton className="h-16 w-full" />
        ) : list.length === 0 ? null : (
          <ul className="space-y-3">
            {list.slice(0, SHOWN).map((e) => {
              const phase = exportPhase(e, now);
              const badge = PHASE_BADGE[phase];
              const size = formatBytes(e.byteSize);
              const contents = categorySummary(e.categories);
              const warnings = staffExportWarnings(e);
              return (
                <li key={e.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      Asked for {new Date(e.createdAt).toLocaleString()}
                    </span>
                    <Badge variant={badge.variant}>
                      {phase === "preparing" && <Loader2 className="size-3 animate-spin" />}
                      {badge.label}
                    </Badge>
                    {size && <span className="text-xs text-muted-foreground">{size}</span>}
                    {e.downloadedAt && (
                      <span className="text-xs text-muted-foreground">Downloaded</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{exportStatusText(e, now)}</p>
                  {phase === "ready" && contents.length > 0 && (
                    <p className="text-xs text-muted-foreground">Contains: {contents.join(", ")}</p>
                  )}
                  {warnings.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/5 p-2">
                      {warnings.map((w) => (
                        <li key={w} className="flex gap-2 text-xs">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {phase === "ready" && (
                      <Button size="sm" onClick={() => void download(e)} disabled={busy.value !== null}>
                        {busy.value === e.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        Download
                      </Button>
                    )}
                    {phase !== "preparing" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void remove(e)}
                        disabled={busy.value !== null}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
