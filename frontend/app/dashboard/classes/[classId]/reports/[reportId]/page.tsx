"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  defaultPdfFileSizeBytes,
  defaultPdfStoragePath,
  downloadReportPdf,
  getReport,
  publishReport,
  regenerateReport,
  saveReportPdf,
  sendReportToMinistry,
  updateReport,
  updateReportEntry,
  uploadReportPdf,
  type ReportDetail,
  type ReportEntryRow,
  type ReportStatus,
} from "@/lib/reports";
import { buildReportPdfBlob, downloadBlob, pdfFilenameForReport } from "@/lib/report-pdf";
import {
  buildYearReportPdfBlob,
  yearReportPdfFilename,
} from "@/lib/report-year-pdf";
import {
  getStudentTermResult,
  getStudentYearResult,
  type StudentTermResult,
  type StudentYearReport,
} from "@/lib/year-report";
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
import { ArrowLeft, Download, FileText, Lock, RefreshCw, Save, Send, Sparkles, Upload } from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
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
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const report = useSignal<ReportDetail | null>(null);
  const termResult = useSignal<StudentTermResult | null>(null);
  const yearResult = useSignal<StudentYearReport | null>(null);
  const termName = useSignal("");
  const loading = useSignal(true);
  const saving = useSignal(false);
  const entrySaving = useSignal<string | null>(null);

  const remark = useSignal("");
  const conduct = useSignal("");
  const attendance = useSignal("");

  const pdfPath = useSignal("");
  const pdfSize = useSignal("");
  const pdfGenerating = useSignal(false);

  const fetchCalcResults = useCallback(
    (info: ClassInfo, rpt: ReportDetail, model: "term_based" | "year_based") => {
      if (!rpt.student_id) return;

      if (model === "year_based" && rpt.report_type === "year_end") {
        getStudentYearResult(rpt.student_id, info.academicYearId, rpt.student_group_id)
          .then((yr) => { yearResult.value = yr; })
          .catch(() => {});
      }

      getStudentTermResult(rpt.student_id, rpt.term_id, rpt.student_group_id)
        .then((tr) => { termResult.value = tr; })
        .catch(() => {});
    },
    [],
  );

  const loadClass = useCallback(() => {
    api<ClassInfo[]>("/classes")
      .then((list) => {
        const info = list.find((c) => c.id === classId) ?? null;
        classInfo.value = info;
        if (info?.academicYearId) {
          api<{ grading_model?: string }>(`/academic-years/${info.academicYearId}`)
            .then((ay) => {
              const model =
                ay.grading_model === "year_based" ? "year_based" : "term_based";
              gradingModel.value = model;
              const rpt = report.value;
              if (rpt && info) fetchCalcResults(info, rpt, model);
            })
            .catch(() => {});

          api<{ id: string; name: string }[]>(`/terms?yearId=${info.academicYearId}`)
            .then((terms) => {
              const rpt = report.value;
              if (rpt?.term_id) {
                const match = terms.find((t) => t.id === rpt.term_id);
                if (match) termName.value = match.name;
              }
            })
            .catch(() => {});
        }
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

        const info = classInfo.value;
        if (info) fetchCalcResults(info, data, gradingModel.value);
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
      const info = classInfo.value;
      if (info) fetchCalcResults(info, full, gradingModel.value);
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
    if (!classInfo.value?.isClassTeacher || locked) return;
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

  const downloadPdf = () => {
    const rpt = report.value;
    if (!rpt) return;

    const yr = yearResult.value;
    if (
      gradingModel.value === "year_based" &&
      rpt.report_type === "year_end" &&
      yr
    ) {
      try {
        const blob = buildYearReportPdfBlob(yr, {
          className: classInfo.value?.name,
        });
        downloadBlob(blob, yearReportPdfFilename(yr));
        toast.success("Year-end PDF downloaded");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not generate PDF";
        toast.error(msg);
      }
      return;
    }

    const trVal = termResult.value;
    if (trVal) {
      try {
        const blob = buildReportPdfBlob(trVal, {
          termName: termName.value || undefined,
          report: rpt,
          entryMap: new Map(rpt.entries.map((e) => [e.subject_id, e])),
        });
        downloadBlob(blob, pdfFilenameForReport(rpt));
        toast.success("PDF downloaded");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not generate PDF";
        toast.error(msg);
      }
    } else {
      toast.error("No calculated grades available for PDF");
    }
  };

  const generateAndUploadPdf = async () => {
    if (!classInfo.value?.isClassTeacher || locked) return;
    const rpt = report.value;
    if (!rpt) return;

    pdfGenerating.value = true;
    try {
      const yr = yearResult.value;
      const trVal = termResult.value;
      const isYearEnd =
        gradingModel.value === "year_based" && rpt.report_type === "year_end" && yr;
      let blob: Blob;
      let filename: string;
      if (isYearEnd) {
        blob = buildYearReportPdfBlob(yr, { className: classInfo.value?.name });
        filename = yearReportPdfFilename(yr);
      } else if (trVal) {
        blob = buildReportPdfBlob(trVal, {
          termName: termName.value || undefined,
          report: rpt,
          entryMap: new Map(rpt.entries.map((e) => [e.subject_id, e])),
        });
        filename = pdfFilenameForReport(rpt);
      } else {
        toast.error("No calculated grades available");
        pdfGenerating.value = false;
        return;
      }
      downloadBlob(blob, filename);

      const objectPath = defaultPdfStoragePath(rpt);
      const row = await uploadReportPdf(reportId, blob, objectPath);
      const pdfs = rpt.pdfs ?? [];
      const merged: ReportDetail = {
        ...rpt,
        pdfs: [row, ...pdfs],
      };
      report.value = merged;
      pdfPath.value = defaultPdfStoragePath(merged);
      pdfSize.value = String(defaultPdfFileSizeBytes(merged));
      toast.success("PDF downloaded and uploaded");
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

  const downloadExistingPdf = async (pdfId: string) => {
    try {
      const rpt = report.value;
      const filename = rpt ? pdfFilenameForReport(rpt) : "report.pdf";
      const blob = await downloadReportPdf(reportId, pdfId);
      downloadBlob(blob, filename);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      toast.error(msg);
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

  if (!report.value || (classInfo.value && !classInfo.value.isClassTeacher)) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/classes/${classId}/reports`)}>
          <ArrowLeft className="mr-2 size-4" /> Back
        </Button>
        <p className="text-muted-foreground">
          {classInfo.value && !classInfo.value.isClassTeacher
            ? "Only the class teacher can view this report."
            : "Report not found."}
        </p>
      </div>
    );
  }

  const r = report.value;
  const st = r.student;
  const isClassTeacher = classInfo.value?.isClassTeacher ?? false;
  const tr = termResult.value;
  const yr = yearResult.value;
  const isYearEnd = gradingModel.value === "year_based" && r.report_type === "year_end" && yr;

  const entryMap = new Map(r.entries.map((e) => [e.subject_id, e]));

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
            {termName.value && (
              <span className="text-muted-foreground text-sm">{termName.value}</span>
            )}
            {(tr?.position != null || r.position != null) && r.total_students != null && (
              <span className="text-muted-foreground text-sm">
                Rank {tr?.position ?? r.position} of {r.total_students}
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
          <CardTitle>Class Teacher</CardTitle>
          <CardDescription>
            Overall remark, conduct, and attendance. {locked && "Editing is disabled after ministry submission."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-xl">
          <div className="space-y-1.5">
            <Label htmlFor="ctr">Class Teacher remark</Label>
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
              {saving.value ? "Saving…" : "Save Class Teacher Fields"}
            </Button>
          )}
        </CardContent>
      </Card>

      {isYearEnd && yr ? (
        <Card>
          <CardHeader>
            <CardTitle>Year-End Subject Results</CardTitle>
            <CardDescription>
              Live calculated grades — each term composite and year grade.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  {yr.terms.map((t) => (
                    <TableHead key={t.termId} className="text-right" title={t.termName}>
                      {t.termName.charAt(0).toUpperCase()}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">End of Yr Exam</TableHead>
                  <TableHead className="text-right">Year Grade</TableHead>
                  <TableHead className="w-24">Letter</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead className="text-right w-24"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yr.yearEnd.subjects.map((sub) => {
                  const entry = entryMap.get(sub.subjectId);
                  const lastTerm = yr.terms[yr.terms.length - 1];
                  const lastTermSubject = lastTerm?.subjects.find(
                    (s) => s.subjectId === sub.subjectId,
                  );
                  return (
                    <YearEntryRow
                      key={sub.subjectId}
                      subjectName={sub.subjectName}
                      termGrades={sub.termGrades}
                      termIds={yr.terms.map((t) => t.termId)}
                      endOfYrExam={lastTermSubject?.examAverage ?? null}
                      yearGrade={sub.yearGrade}
                      entry={entry ?? null}
                      locked={!!locked}
                      busy={entrySaving.value === entry?.id}
                      onSave={entry ? (tr, lg) => saveEntry(entry.id, tr, lg) : undefined}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Subject Results</CardTitle>
            <CardDescription>
              {tr
                ? "Live calculated grades from assessments."
                : "Grades from the generated report."}
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
                  <TableHead className="w-24">Letter</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead className="text-right w-24"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tr ? tr.subjects : r.entries).map((sub) => {
                  const isTerm = "subjectId" in sub;
                  const subjectId = isTerm ? sub.subjectId : sub.subject_id;
                  const subjectName = isTerm ? sub.subjectName : (sub.subject?.name ?? "-");
                  const cw = isTerm ? sub.courseworkAverage : sub.coursework_average;
                  const ex = isTerm ? sub.examAverage : sub.exam_average;
                  const tc = isTerm ? sub.termComposite : sub.term_composite;
                  const entry = entryMap.get(subjectId);
                  return (
                    <TermEntryRow
                      key={subjectId}
                      subjectName={subjectName}
                      coursework={cw}
                      exam={ex}
                      termComposite={tc}
                      entry={entry ?? null}
                      locked={!!locked}
                      busy={entrySaving.value === entry?.id}
                      onSave={entry ? (tr, lg) => saveEntry(entry.id, tr, lg) : undefined}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            PDF
          </CardTitle>
          <CardDescription>
            Download the report as a PDF, or generate and upload to cloud storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="default" onClick={downloadPdf}>
              <Download className="mr-2 size-4" />
              Download PDF
            </Button>
            {isClassTeacher && !locked && (
              <Button
                size="sm"
                variant="outline"
                onClick={generateAndUploadPdf}
                disabled={pdfGenerating.value}
              >
                <Upload className="mr-2 size-4" />
                {pdfGenerating.value ? "Working…" : "Generate & upload to storage"}
              </Button>
            )}
          </div>

          {r.pdfs.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">PDF history</p>
              <ul className="space-y-2 text-sm">
                {r.pdfs.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <code className="text-xs break-all">{p.file_path}</code>
                      <span className="text-muted-foreground">
                        {(p.file_size / 1024).toFixed(1)} KB ·{" "}
                        {new Date(p.generated_at).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => downloadExistingPdf(p.id)}
                    >
                      <Download className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isClassTeacher && !locked && (
            <details className="border-t pt-4">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                Register PDF manually
              </summary>
              <div className="flex flex-col gap-3 max-w-lg mt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pdfPath">Storage path</Label>
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
                  <Label htmlFor="pdfSize">File size in bytes</Label>
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
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

function TermEntryRow({
  subjectName,
  coursework,
  exam,
  termComposite,
  entry,
  locked,
  busy,
  onSave,
}: {
  subjectName: string;
  coursework: number | null;
  exam: number | null;
  termComposite: number | null;
  entry: ReportEntryRow | null;
  locked: boolean;
  busy: boolean;
  onSave?: (teacherRemark: string, letterGrade: string) => void;
}) {
  useSignals();
  const remarkVal = useSignal(entry?.teacher_remark ?? "");
  const letter = useSignal(entry?.letter_grade ?? "");

  useEffect(() => {
    remarkVal.value = entry?.teacher_remark ?? "";
    letter.value = entry?.letter_grade ?? "";
  }, [entry?.id, entry?.teacher_remark, entry?.letter_grade]);

  return (
    <TableRow>
      <TableCell className="font-medium">{subjectName}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {fmtNum(coursework)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {fmtNum(exam)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtNum(termComposite)}
      </TableCell>
      <TableCell>
        <Input
          className="h-8 max-w-[4.5rem]"
          disabled={locked || !onSave}
          value={letter.value}
          onChange={(ev) => { letter.value = ev.target.value; }}
          placeholder="A"
        />
      </TableCell>
      <TableCell>
        <Input
          disabled={locked || !onSave}
          value={remarkVal.value}
          onChange={(ev) => { remarkVal.value = ev.target.value; }}
          placeholder="Comment"
        />
      </TableCell>
      <TableCell className="text-right">
        {onSave ? (
          <Button
            size="sm"
            variant="outline"
            disabled={locked || busy}
            onClick={() => onSave(remarkVal.value, letter.value)}
          >
            {busy ? "…" : "Save"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function YearEntryRow({
  subjectName,
  termGrades,
  termIds,
  endOfYrExam,
  yearGrade,
  entry,
  locked,
  busy,
  onSave,
}: {
  subjectName: string;
  termGrades: { termId: string; termName: string; termComposite: number | null }[];
  termIds: string[];
  endOfYrExam: number | null;
  yearGrade: number | null;
  entry: ReportEntryRow | null;
  locked: boolean;
  busy: boolean;
  onSave?: (teacherRemark: string, letterGrade: string) => void;
}) {
  useSignals();
  const remarkVal = useSignal(entry?.teacher_remark ?? "");
  const letter = useSignal(entry?.letter_grade ?? "");

  useEffect(() => {
    remarkVal.value = entry?.teacher_remark ?? "";
    letter.value = entry?.letter_grade ?? "";
  }, [entry?.id, entry?.teacher_remark, entry?.letter_grade]);

  return (
    <TableRow>
      <TableCell className="font-medium">{subjectName}</TableCell>
      {termIds.map((tid) => {
        const tg = termGrades.find((g) => g.termId === tid);
        return (
          <TableCell key={tid} className="text-right tabular-nums text-muted-foreground">
            {fmtNum(tg?.termComposite ?? null)}
          </TableCell>
        );
      })}
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {fmtNum(endOfYrExam)}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {fmtNum(yearGrade)}
      </TableCell>
      <TableCell>
        <Input
          className="h-8 max-w-[4.5rem]"
          disabled={locked || !onSave}
          value={letter.value}
          onChange={(ev) => { letter.value = ev.target.value; }}
          placeholder="A"
        />
      </TableCell>
      <TableCell>
        <Input
          disabled={locked || !onSave}
          value={remarkVal.value}
          onChange={(ev) => { remarkVal.value = ev.target.value; }}
          placeholder="Comment"
        />
      </TableCell>
      <TableCell className="text-right">
        {onSave ? (
          <Button
            size="sm"
            variant="outline"
            disabled={locked || busy}
            onClick={() => onSave(remarkVal.value, letter.value)}
          >
            {busy ? "…" : "Save"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
