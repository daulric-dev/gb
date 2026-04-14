"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  defaultPdfFileSizeBytes,
  defaultPdfStoragePath,
  getReport,
  publishReport,
  regenerateReport,
  saveReportPdf,
  sendReportToMinistry,
  updateReport,
  updateReportEntry,
  type ReportDetail,
  type ReportEntryRow,
  type ReportStatus,
} from "@/lib/reports";
import { buildReportPdfBlob, uploadReportPdfToStorage, objectPathForReport } from "@/lib/report-pdf";
import { isSupabaseConfigured } from "@/lib/supabase-browser";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft,FileText,Lock,RefreshCw,Save,Send,Sparkles,Upload } from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  isClassTeacher: boolean;
}

function statusLabel(status: ReportStatus | null) {
  switch (status) {
    case "published":
      return <Badge>Published</Badge>;
    case "sent_to_ministry":
      return <Badge variant="secondary">Sent to ministry</Badge>;
    default:
      return <Badge variant="outline">Draft</Badge>;
  }
}

export default function ReportDetailPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params.classId as string;
  const reportId = params.reportId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const report = useSignal<ReportDetail | null>(null);
  const loading = useSignal(true);
  const saving = useSignal(false);
  const entrySaving = useSignal<string | null>(null);

  const remark = useSignal("");
  const conduct = useSignal("");
  const attendance = useSignal("");

  const pdfPath = useSignal("");
  const pdfSize = useSignal("");
  const pdfGenerating = useSignal(false);

  const loadClass = useCallback(() => {
    api<ClassInfo[]>("/classes")
      .then((list) => {
        const info = list.find((c) => c.id === classId) ?? null;
        classInfo.value = info;
      })
      .catch(() => {});
  }, [classId]);

  const loadReport = useCallback(() => {
    loading.value = true;
    getReport(reportId)
      .then((data) => {
        report.value = data;
        remark.value = data.class_teacher_remark ?? "";
        conduct.value = data.conduct ?? "";
        attendance.value =
          data.attendance_percentage != null ? String(data.attendance_percentage) : "";
        pdfPath.value = defaultPdfStoragePath(data);
        pdfSize.value = String(defaultPdfFileSizeBytes(data));
      })
      .catch((e) => {
        report.value = null;
        const msg = e instanceof ApiError ? e.message : "Failed to load report";
        toast.error(msg);
      })
      .finally(() => {
        loading.value = false;
      });
  }, [reportId]);

  useEffect(() => {
    loadClass();
  }, [loadClass]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const locked = report.value?.status === "sent_to_ministry";

  const saveClassTeacherFields = async () => {
    if (!report.value || locked) return;
    saving.value = true;
    try {
      const attendanceNum = attendance.value.trim() === "" ? undefined : Number(attendance.value);
      if (
        attendance.value.trim() !== "" &&
        (Number.isNaN(attendanceNum!) || attendanceNum! < 0 || attendanceNum! > 100)
      ) {
        toast.error("Attendance must be between 0 and 100");
        saving.value = false;
        return;
      }
      const updated = await updateReport(reportId, {
        classTeacherRemark: remark.value || undefined,
        conduct: conduct.value || undefined,
        attendancePercentage: attendanceNum,
      });
      report.value = { ...report.value!, ...updated };
      toast.success("Report updated");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Save failed";
      toast.error(msg);
    } finally {
      saving.value = false;
    }
  };

  const saveEntry = async (entryId: string, teacherRemark: string, letterGrade: string) => {
    if (locked) return;
    entrySaving.value = entryId;
    try {
      const row = await updateReportEntry(entryId, {
        teacherRemark: teacherRemark || undefined,
        letterGrade: letterGrade || undefined,
      });
      const entries = report.value?.entries ?? [];
      report.value = {
        ...report.value!,
        entries: entries.map((e) => (e.id === entryId ? { ...e, ...row } : e)),
      };
      toast.success("Entry saved");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not save entry";
      toast.error(msg);
    } finally {
      entrySaving.value = null;
    }
  };

  const runRegenerate = async () => {
    if (!classInfo.value?.isClassTeacher) return;
    try {
      const full = await regenerateReport(reportId);
      report.value = full;
      remark.value = full.class_teacher_remark ?? "";
      conduct.value = full.conduct ?? "";
      attendance.value =
        full.attendance_percentage != null ? String(full.attendance_percentage) : "";
      pdfPath.value = defaultPdfStoragePath(full);
      pdfSize.value = String(defaultPdfFileSizeBytes(full));
      toast.success("Grades recalculated");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Regenerate failed";
      toast.error(msg);
    }
  };

  const runPublish = async () => {
    if (!classInfo.value?.isClassTeacher) return;
    try {
      const updated = await publishReport(reportId);
      report.value = report.value ? { ...report.value, ...updated } : null;
      toast.success("Report published");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Publish failed";
      toast.error(msg);
    }
  };

  const runMinistry = async () => {
    if (!classInfo.value?.isClassTeacher) return;
    try {
      const updated = await sendReportToMinistry(reportId);
      report.value = report.value ? { ...report.value, ...updated } : null;
      toast.success("Marked as sent to ministry");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Update failed";
      toast.error(msg);
    }
  };

  const recordPdf = async () => {
    if (!classInfo.value?.isClassTeacher) return;
    const rpt = report.value;
    if (!rpt) return;

    const path = pdfPath.value.trim() || defaultPdfStoragePath(rpt);
    const sizeRaw = pdfSize.value.trim();
    const size =
      sizeRaw === ""
        ? defaultPdfFileSizeBytes(rpt)
        : Math.round(Number(sizeRaw));

    if (!path || !Number.isFinite(size) || size < 1) {
      toast.error("Invalid file size (must be at least 1 byte)");
      return;
    }
    try {
      const row = await saveReportPdf(reportId, { filePath: path, fileSize: size });
      const pdfs = rpt.pdfs ?? [];
      const merged: ReportDetail = {
        ...rpt,
        pdfs: [row, ...pdfs],
      };
      report.value = merged;
      pdfPath.value = defaultPdfStoragePath(merged);
      pdfSize.value = String(defaultPdfFileSizeBytes(merged));
      toast.success("PDF record saved");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not save PDF record";
      toast.error(msg);
    }
  };

  const generateAndUploadPdf = async () => {
    if (!classInfo.value?.isClassTeacher || locked) return;
    const rpt = report.value;
    if (!rpt) return;

    if (!isSupabaseConfigured()) {
      toast.error(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (Supabase project → Settings → API).",
      );
      return;
    }

    pdfGenerating.value = true;
    try {
      const blob = buildReportPdfBlob(rpt);
      const objectPath = objectPathForReport(rpt);
      await uploadReportPdfToStorage(objectPath, blob);
      const row = await saveReportPdf(reportId, {
        filePath: objectPath,
        fileSize: blob.size,
      });
      const pdfs = rpt.pdfs ?? [];
      const merged: ReportDetail = {
        ...rpt,
        pdfs: [row, ...pdfs],
      };
      report.value = merged;
      pdfPath.value = defaultPdfStoragePath(merged);
      pdfSize.value = String(defaultPdfFileSizeBytes(merged));
      toast.success("PDF generated, uploaded, and recorded");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not create or upload PDF";
      toast.error(msg);
    } finally {
      pdfGenerating.value = false;
    }
  };

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!report.value) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/classes/${classId}/reports`)}>
          <ArrowLeft className="mr-2 size-4" /> Back
        </Button>
        <p className="text-muted-foreground">Report not found.</p>
      </div>
    );
  }

  const r = report.value;
  const st = r.student;
  const isClassTeacher = classInfo.value?.isClassTeacher ?? false;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={
          st
            ? `${st.first_name} ${st.last_name}`
            : "Report"
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {statusLabel(r.status)}
            {r.position != null && r.total_students != null && (
              <span className="text-muted-foreground text-sm">
                Rank {r.position} of {r.total_students}
              </span>
            )}
            {locked && (
              <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
                <Lock className="size-3.5" />
                Locked (ministry)
              </span>
            )}
          </span>
        }
        onBack={() => router.push(`/dashboard/classes/${classId}/reports`)}
        actions={
          isClassTeacher && !locked ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={runRegenerate}>
                <RefreshCw className="mr-1.5 size-3.5" />
                Regenerate grades
              </Button>
              {r.status === "draft" && (
                <Button size="sm" onClick={runPublish}>
                  <Sparkles className="mr-1.5 size-3.5" />
                  Publish
                </Button>
              )}
              {r.status === "published" && (
                <Button size="sm" variant="secondary" onClick={runMinistry}>
                  <Send className="mr-1.5 size-3.5" />
                  Send to ministry
                </Button>
              )}
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Class teacher</CardTitle>
          <CardDescription>
            Overall remark, conduct, and attendance. {locked && "Editing is disabled after ministry submission."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-xl">
          <div className="space-y-1.5">
            <Label htmlFor="ctr">Class teacher remark</Label>
            <textarea
              id="ctr"
              disabled={locked || !isClassTeacher}
              className="min-h-[88px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              value={remark.value}
              onChange={(e) => {
                remark.value = e.target.value;
              }}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="conduct">Conduct</Label>
              <Input
                id="conduct"
                disabled={locked || !isClassTeacher}
                value={conduct.value}
                onChange={(e) => {
                  conduct.value = e.target.value;
                }}
                placeholder="e.g. Excellent"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att">Attendance %</Label>
              <Input
                id="att"
                type="number"
                min={0}
                max={100}
                step={0.1}
                disabled={locked || !isClassTeacher}
                value={attendance.value}
                onChange={(e) => {
                  attendance.value = e.target.value;
                }}
              />
            </div>
          </div>
          {isClassTeacher && !locked && (
            <Button onClick={saveClassTeacherFields} disabled={saving.value}>
              <Save className="mr-2 size-4" />
              {saving.value ? "Saving…" : "Save class teacher fields"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subject results</CardTitle>
          <CardDescription>
            Subject teachers can add remarks and letter grades. Calculated averages refresh when the class teacher
            regenerates reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Coursework</TableHead>
                <TableHead className="text-right">Exam</TableHead>
                <TableHead className="text-right">Term</TableHead>
                <TableHead className="text-right">Year</TableHead>
                <TableHead className="w-24">Letter</TableHead>
                <TableHead>Remark</TableHead>
                <TableHead className="text-right w-24"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  locked={!!locked}
                  busy={entrySaving.value === e.id}
                  onSave={(tr, lg) => saveEntry(e.id, tr, lg)}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            PDF history
          </CardTitle>
          <CardDescription>
            Use <strong>Generate PDF</strong> to build a PDF in the browser, upload it to the{" "}
            <code className="text-xs">report-cards</code> bucket, and save the record. Requires{" "}
            <code className="text-xs">NEXT_PUBLIC_SUPABASE_*</code> in <code className="text-xs">.env.local</code>.
            Or register a path manually if you uploaded elsewhere. Latest versions appear first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {r.pdfs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PDF versions recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {r.pdfs.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-0.5 rounded-md border border-border/60 px-3 py-2"
                >
                  <code className="text-xs break-all">{p.file_path}</code>
                  <span className="text-muted-foreground">
                    {(p.file_size / 1024).toFixed(1)} KB ·{" "}
                    {new Date(p.generated_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {isClassTeacher && !locked && (
            <div className="flex flex-col gap-3 max-w-lg border-t pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={generateAndUploadPdf}
                  disabled={pdfGenerating.value}
                >
                  <Upload className="mr-2 size-4" />
                  {pdfGenerating.value ? "Working…" : "Generate PDF & upload"}
                </Button>
              </div>
              <p className="text-sm font-medium text-muted-foreground">Or register manually</p>
              <div className="space-y-1.5">
                <Label htmlFor="pdfPath">Storage path (default)</Label>
                <Input
                  id="pdfPath"
                  value={pdfPath.value}
                  onChange={(e) => {
                    pdfPath.value = e.target.value;
                  }}
                  placeholder={defaultPdfStoragePath(r)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdfSize">File size in bytes (default)</Label>
                <Input
                  id="pdfSize"
                  type="number"
                  min={1}
                  value={pdfSize.value}
                  onChange={(e) => {
                    pdfSize.value = e.target.value;
                  }}
                  placeholder={String(defaultPdfFileSizeBytes(r))}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={recordPdf}>
                Save PDF record
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EntryRow({
  entry: e,
  locked,
  busy,
  onSave,
}: {
  entry: ReportEntryRow;
  locked: boolean;
  busy: boolean;
  onSave: (teacherRemark: string, letterGrade: string) => void;
}) {
  useSignals();
  const remark = useSignal(e.teacher_remark ?? "");
  const letter = useSignal(e.letter_grade ?? "");

  useEffect(() => {
    remark.value = e.teacher_remark ?? "";
    letter.value = e.letter_grade ?? "";
  }, [e.id, e.teacher_remark, e.letter_grade]);

  const subj = e.subject;

  return (
    <TableRow>
      <TableCell className="font-medium">{subj ? subj.name : "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {e.coursework_average != null ? e.coursework_average.toFixed(1) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {e.exam_average != null ? e.exam_average.toFixed(1) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {e.term_composite != null ? e.term_composite.toFixed(1) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {e.year_grade != null ? e.year_grade.toFixed(1) : "—"}
      </TableCell>
      <TableCell>
        <Input
          className="h-8 max-w-[4.5rem]"
          disabled={locked}
          value={letter.value}
          onChange={(ev) => {
            letter.value = ev.target.value;
          }}
          placeholder="A"
        />
      </TableCell>
      <TableCell>
        <Input
          disabled={locked}
          value={remark.value}
          onChange={(ev) => {
            remark.value = ev.target.value;
          }}
          placeholder="Comment"
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={locked || busy}
          onClick={() => onSave(remark.value, letter.value)}
        >
          {busy ? "…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
