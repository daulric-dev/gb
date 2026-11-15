"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Download, Eye, FileBadge, Loader2, RefreshCw, Save, Send, Undo2 } from "lucide-react";
import { api, ApiError, buildUrl } from "@/lib/api";
import { downloadFromUrl } from "@/lib/download";
import { userMessage } from "@/lib/errors";
import { personName } from "@/lib/courses/format";
import { NoTranslate } from "@/components/translation/no-translate";
import {
  completionPercent,
  deadlineState,
  documentSummary,
  publishWarnings,
  REPORT_COMMENT_MAX,
  reportFallbackName,
  termLabel,
  type ReleaseOverview,
  type ReleaseStudent,
  type ReleaseTerm,
} from "@/lib/report-cards";
import { usePermissions } from "@/providers/PermissionsProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** A datetime-local input value for an ISO string, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Fetch a PDF with the session and open it in a new tab. */
async function openPdf(path: string) {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(buildUrl(path), { headers: { "X-API-Version": "1" }, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, body.message || res.statusText, body);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/**
 * The school's report card release: per-term completion of teacher comments,
 * head comments, previews, publishing and downloads.
 */
export default function ReportReleasePage() {
  useSignals();
  const { can, loading: permissionsLoading } = usePermissions();
  const canUpdate = can("report-card", "update");

  const terms = useSignal<ReleaseTerm[] | null>(null);
  const termId = useSignal<string | null>(null);
  const overview = useSignal<ReleaseOverview | null>(null);
  const students = useSignal<ReleaseStudent[]>([]);
  const heads = useSignal<Record<string, string>>({});
  const deadline = useSignal("");
  const busy = useSignal<string | null>(null);
  const confirming = useSignal<"publish" | "unpublish" | null>(null);

  async function loadTerm(id: string) {
    termId.value = id;
    overview.value = null;
    try {
      const [o, s] = await Promise.all([
        api<ReleaseOverview>(`/report-cards/terms/${id}`),
        api<ReleaseStudent[]>(`/report-cards/terms/${id}/students`),
      ]);
      overview.value = o;
      students.value = s;
      heads.value = Object.fromEntries(s.map((x) => [x.studentId, x.headComment]));
      deadline.value = toLocalInput(o.commentDeadline);
    } catch (err) {
      toast.error(userMessage(err, "Failed to load the term"));
    }
  }

  useEffect(() => {
    if (permissionsLoading || !can("report-card", "read")) return;
    api<ReleaseTerm[]>("/report-cards/terms")
      .then((list) => {
        terms.value = list;
        const now = new Date().toISOString().slice(0, 10);
        const current =
          list.find((t) => (!t.startDate || t.startDate <= now) && (!t.endDate || t.endDate >= now)) ??
          list[list.length - 1];
        if (current) void loadTerm(current.id);
      })
      .catch((err) => {
        terms.value = [];
        toast.error(userMessage(err, "Failed to load terms"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading]);

  async function run(label: string, fn: () => Promise<void>) {
    busy.value = label;
    try {
      await fn();
    } catch (err) {
      toast.error(userMessage(err, "Something went wrong"));
    } finally {
      busy.value = null;
    }
  }

  const o = overview.value;
  const id = termId.value;

  const saveDeadline = () =>
    run("deadline", async () => {
      overview.value = await api<ReleaseOverview>(`/report-cards/terms/${id}`, {
        method: "PATCH",
        body: { commentDeadline: deadline.value ? new Date(deadline.value).toISOString() : null },
      });
      toast.success("Deadline saved");
    });

  const setPublished = (publish: boolean) =>
    run(publish ? "publish" : "unpublish", async () => {
      overview.value = await api<ReleaseOverview>(
        `/report-cards/terms/${id}/${publish ? "publish" : "unpublish"}`,
        { method: "POST" },
      );
      confirming.value = null;
      students.value = await api<ReleaseStudent[]>(`/report-cards/terms/${id}/students`);
      toast.success(publish ? "Published; PDFs are being generated" : "Reports hidden from students");
    });

  const regenerate = (failedOnly: boolean) =>
    run("regenerate", async () => {
      overview.value = await api<ReleaseOverview>(`/report-cards/terms/${id}/regenerate`, {
        method: "POST",
        body: { failedOnly },
      });
      toast.success("Generating again");
    });

  const changedHeads = students.value.filter((s) => (heads.value[s.studentId] ?? "").trim() !== s.headComment.trim());
  const saveHeads = () =>
    run("heads", async () => {
      students.value = await api<ReleaseStudent[]>(`/report-cards/terms/${id}/head-comments`, {
        method: "PUT",
        body: { comments: changedHeads.map((s) => ({ studentId: s.studentId, body: heads.value[s.studentId] ?? "" })) },
      });
      toast.success("Head comments saved");
    });

  const refresh = () => id && run("refresh", () => loadTerm(id));

  if (!permissionsLoading && !can("report-card", "read")) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>You can&apos;t view report cards</EmptyTitle>
          <EmptyDescription>Ask a school admin for the report card permission.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Report cards"
        description="Check teachers' comments, add head comments, preview and publish each term's reports."
        action={
          terms.value && terms.value.length > 0 ? (
            <NativeSelect
              aria-label="Term"
              value={id ?? ""}
              onChange={(e) => void loadTerm(e.target.value)}
            >
              {terms.value.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {termLabel(t)}
                  {t.publishedAt ? " (published)" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : undefined
        }
      />

      {terms.value === null || (id && !o) ? (
        <Skeleton className="h-64 w-full" />
      ) : terms.value.length === 0 || !o ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileBadge />
            </EmptyMedia>
            <EmptyTitle>No terms yet</EmptyTitle>
            <EmptyDescription>Add terms in the academic calendar; each term gets its own reports.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {termLabel(o.term)}
                {o.publishedAt ? (
                  <Badge>Published</Badge>
                ) : (
                  <Badge variant="outline">Not published</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {o.publishedAt
                  ? `Published ${new Date(o.publishedAt).toLocaleString()}${o.publishedBy ? ` by ${o.publishedBy}` : ""}. PDFs: ${documentSummary(o.documents)}.`
                  : `${o.students} students · ${o.totals.ready} of ${o.totals.comments} comments ready`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={completionPercent({ ready: o.totals.ready, students: o.totals.comments })} aria-label="Comments ready" />
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">Comment deadline</span>
                  <Input
                    type="datetime-local"
                    value={deadline.value}
                    disabled={!canUpdate}
                    onChange={(e) => (deadline.value = e.target.value)}
                    className="w-56"
                  />
                </label>
                {canUpdate && (
                  <Button variant="outline" onClick={saveDeadline} disabled={busy.value !== null}>
                    Save deadline
                  </Button>
                )}
                {deadlineState(o.commentDeadline) === "passed" && !o.publishedAt && (
                  <Badge variant="destructive">Deadline passed</Badge>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={refresh} disabled={busy.value !== null} aria-label="Refresh">
                    <RefreshCw className="size-4" />
                  </Button>
                  {o.documents.ready > 0 && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        run("zip", () => downloadFromUrl(`/report-cards/terms/${id}/reports.zip`, "reports.zip"))
                      }
                      disabled={busy.value !== null}
                    >
                      <Download className="mr-2 size-4" />
                      All PDFs (zip)
                    </Button>
                  )}
                  {canUpdate && o.publishedAt && o.documents.failed > 0 && (
                    <Button variant="outline" onClick={() => regenerate(true)} disabled={busy.value !== null}>
                      Retry failed
                    </Button>
                  )}
                  {canUpdate &&
                    (o.publishedAt ? (
                      <Button variant="outline" onClick={() => (confirming.value = "unpublish")} disabled={busy.value !== null}>
                        <Undo2 className="mr-2 size-4" />
                        Unpublish
                      </Button>
                    ) : (
                      <Button onClick={() => (confirming.value = "publish")} disabled={busy.value !== null}>
                        <Send className="mr-2 size-4" />
                        Publish
                      </Button>
                    ))}
                </div>
              </div>
              {o.generationMode === "inline" && o.publishedAt && o.documents.pending > 0 && (
                <p className="text-xs text-muted-foreground">
                  PDFs are generated on this server one by one; refresh to see progress.
                </p>
              )}
            </CardContent>
          </Card>

          <section className="space-y-2" aria-labelledby="courses-heading">
            <h2 id="courses-heading" className="text-lg font-semibold">Teacher comments by course</h2>
            {o.courses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No published courses belong to this term.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Course</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Teachers</th>
                      <th scope="col" className="w-48 px-3 py-2 font-semibold">Ready</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Draft</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Missing</th>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">Download</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.courses.map((c) => (
                      <tr key={c.courseId} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {c.name}
                          {c.code && <span className="ml-1 font-mono text-xs text-muted-foreground" translate="no">{c.code}</span>}
                          {c.yearLong && <Badge variant="outline" className="ml-2">Year-long</Badge>}
                        </th>
                        <td className="px-3 py-2 text-muted-foreground" translate="no">{c.teachers.join(", ") || "-"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={completionPercent(c)} className="w-24" aria-label={`${c.name} comments ready`} />
                            <span className="tabular-nums">{c.ready}/{c.students}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.draft}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.missing}</td>
                        <td className="px-3 py-2 text-right">
                          {o.documents.ready > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Download ${c.name} class PDFs`}
                              onClick={() =>
                                run("zip", () =>
                                  downloadFromUrl(`/report-cards/terms/${id}/reports.zip?courseId=${c.courseId}`, "reports.zip"),
                                )
                              }
                            >
                              <Download className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-2" aria-labelledby="students-heading">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="students-heading" className="text-lg font-semibold">Students and head comments</h2>
              {canUpdate && !o.publishedAt && (
                <Button onClick={saveHeads} disabled={busy.value !== null || changedHeads.length === 0}>
                  {busy.value === "heads" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save head comments{changedHeads.length ? ` (${changedHeads.length})` : ""}
                </Button>
              )}
            </div>
            {students.value.length === 0 ? (
              <p className="text-sm text-muted-foreground">No students on this term&apos;s reports.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Student</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Head / form tutor comment</th>
                      <th scope="col" className="px-3 py-2 font-semibold">PDF</th>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.value.map((s) => {
                      const name = personName(s);
                      return (
                        <tr key={s.studentId} className="border-t align-top">
                          <th scope="row" className="px-3 py-2 text-left font-medium">
                            <NoTranslate>{name}</NoTranslate>
                            <span className="block text-xs font-normal text-muted-foreground">
                              {s.courses} course{s.courses === 1 ? "" : "s"}
                            </span>
                          </th>
                          <td className="px-3 py-2">
                            <Textarea
                              aria-label={`Head comment for ${name}`}
                              data-private-label
                              rows={2}
                              maxLength={REPORT_COMMENT_MAX}
                              disabled={!canUpdate || !!o.publishedAt}
                              value={heads.value[s.studentId] ?? ""}
                              onChange={(e) => (heads.value = { ...heads.value, [s.studentId]: e.target.value })}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {s.document ? (
                              <Badge
                                variant={s.document.status === "failed" ? "destructive" : s.document.status === "ready" ? "secondary" : "outline"}
                                title={s.document.error ?? undefined}
                              >
                                {s.document.status === "pending" ? "Generating" : s.document.status === "ready" ? "Ready" : "Failed"}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Preview ${name}'s report`}
                              data-private-label
                              onClick={() =>
                                run("preview", () => openPdf(`/report-cards/terms/${id}/students/${s.studentId}/preview`))
                              }
                            >
                              <Eye className="size-4" />
                            </Button>
                            {s.document?.status === "ready" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Download ${name}'s report`}
                                data-private-label
                                onClick={() =>
                                  run("download", () =>
                                    downloadFromUrl(
                                      `/report-cards/terms/${id}/students/${s.studentId}/file`,
                                      reportFallbackName(s, o.term.name),
                                    ),
                                  )
                                }
                              >
                                <Download className="size-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                run("transcript", () => openPdf(`/report-cards/students/${s.studentId}/transcript.pdf`))
                              }
                            >
                              Transcript
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <AlertDialog open={confirming.value !== null} onOpenChange={(v) => !v && (confirming.value = null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirming.value === "publish" ? `Publish ${termLabel(o.term)} reports?` : "Unpublish these reports?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirming.value === "publish"
                    ? "Students will see their reports, and a PDF is generated for each student. Comments are locked until you unpublish."
                    : "Students will no longer see these reports. Teachers can change comments again; PDFs are made afresh when you publish again."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {confirming.value === "publish" && publishWarnings(o).length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
                  {publishWarnings(o).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy.value !== null}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy.value !== null}
                  onClick={() => setPublished(confirming.value === "publish")}
                >
                  {confirming.value === "publish" ? "Publish" : "Unpublish"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
