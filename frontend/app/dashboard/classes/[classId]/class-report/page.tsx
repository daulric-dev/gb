"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  getClassSummaryFiles,
  uploadClassSummaryFile,
  downloadClassSummaryFile,
  type ClassSummary,
  type ClassReportFile,
  type ReportType,
  buildClassSummaryPdfBlob,
  downloadBlob,
  buildClassSummaryCsv,
  buildClassSummaryXlsx,
  getClassTermResults,
  getClassYearResults,
  termResultsToClassSummary,
  type StudentYearReport,
  buildYearClassSummaryPdfBlob,
  buildYearClassSummaryCsv,
  buildYearClassSummaryXlsx,
  buildEndOfYearExamPdfBlob,
} from "@/lib/reports";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Upload,
} from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

interface Term {
  id: string;
  name: string;
  sort_order: number;
  coursework_weight: number;
  exam_weight: number;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ClassReportPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params?.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const terms = useSignal<Term[]>([]);
  const selectedTermId = useSignal("");
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const reportType = useSignal<ReportType>("term");
  const summary = useSignal<ClassSummary | null>(null);
  const yearResults = useSignal<StudentYearReport[]>([]);
  const academicYearName = useSignal("");
  const yearCwWeight = useSignal<number | null>(null);
  const yearExWeight = useSignal<number | null>(null);
  const storedFiles = useSignal<ClassReportFile[]>([]);
  const loading = useSignal(true);
  const dataLoading = useSignal(false);
  const generating = useSignal(false);

  const loadClass = useCallback(() => {
    loading.value = true;
    api<ClassInfo[]>("/classes")
      .then((list) => {
        const info = list.find((c) => c.id === classId) ?? null;
        classInfo.value = info;
        if (info?.academicYearId) {
          api<{
            grading_model?: string;
            name?: string;
            year_coursework_weight?: number;
            year_exam_weight?: number;
          }>(`/academic-years/${info.academicYearId}`)
            .then((ay) => {
              const model = ay.grading_model === "year_based" ? "year_based" : "term_based";
              gradingModel.value = model;
              academicYearName.value = ay.name ?? "";
              yearCwWeight.value = ay.year_coursework_weight ?? null;
              yearExWeight.value = ay.year_exam_weight ?? null;
              if (model === "term_based") {
                reportType.value = "term";
              }
            })
            .catch(() => {});

          api<Term[]>(`/terms?yearId=${info.academicYearId}`)
            .then((t) => {
              const sorted = t.sort((a, b) => a.sort_order - b.sort_order);
              terms.value = sorted;
              if (sorted.length > 0 && !selectedTermId.value) {
                selectedTermId.value = sorted[0].id;
              }
            })
            .catch(() => toast.error("Failed to load terms"));
        }
      })
      .catch(() => {
        classInfo.value = null;
        toast.error("Failed to load class");
      })
      .finally(() => {
        loading.value = false;
      });
  }, [classId]);

  useEffect(() => {
    loadClass();
  }, [loadClass]);

  const fetchSummary = useCallback(() => {
    if (!selectedTermId.value) {
      summary.value = null;
      yearResults.value = [];
      return;
    }
    dataLoading.value = true;

    const isYearEnd =
      reportType.value === "year_end" && gradingModel.value === "year_based";

    const filesPromise = getClassSummaryFiles(classId, selectedTermId.value, reportType.value)
      .catch(() => [] as ClassReportFile[]);

    if (isYearEnd && classInfo.value?.academicYearId) {
      Promise.all([
        getClassYearResults(classInfo.value.academicYearId, classId),
        getClassTermResults(selectedTermId.value, classId),
        filesPromise,
      ])
        .then(([yrData, termData, files]) => {
          yearResults.value = yrData;
          const selectedTerm = terms.value.find((t) => t.id === selectedTermId.value);
          summary.value = termResultsToClassSummary(termData, {
            courseworkWeight: selectedTerm?.coursework_weight ?? 60,
            examWeight: selectedTerm?.exam_weight ?? 40,
            gradingModel: gradingModel.value,
          });
          storedFiles.value = files;
        })
        .catch((e) => {
          summary.value = null;
          yearResults.value = [];
          storedFiles.value = [];
          const msg = e instanceof ApiError ? e.message : "Failed to load class data";
          toast.error(msg);
        })
        .finally(() => { dataLoading.value = false; });
    } else {
      Promise.all([
        getClassTermResults(selectedTermId.value, classId),
        filesPromise,
      ])
        .then(([termData, files]) => {
          const selectedTerm = terms.value.find((t) => t.id === selectedTermId.value);
          summary.value = termResultsToClassSummary(termData, {
            courseworkWeight: selectedTerm?.coursework_weight ?? 60,
            examWeight: selectedTerm?.exam_weight ?? 40,
            gradingModel: gradingModel.value,
          });
          storedFiles.value = files;
          yearResults.value = [];
        })
        .catch((e) => {
          summary.value = null;
          storedFiles.value = [];
          yearResults.value = [];
          const msg = e instanceof ApiError ? e.message : "Failed to load class data";
          toast.error(msg);
        })
        .finally(() => { dataLoading.value = false; });
    }
  }, [classId, selectedTermId.value, reportType.value, gradingModel.value, classInfo.value?.academicYearId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const className = classInfo.value?.name ?? "Class";
  const selectedTermName =
    terms.value.find((t) => t.id === selectedTermId.value)?.name ?? "";

  const yearOpts = {
    academicYearName: academicYearName.value || undefined,
    yearCwWeight: yearCwWeight.value ?? undefined,
    yearExWeight: yearExWeight.value ?? undefined,
  };

  const isYearEnd =
    reportType.value === "year_end" && gradingModel.value === "year_based";

  const downloadPdf = () => {
    if (isYearEnd && yearResults.value.length > 0) {
      const blob = buildYearClassSummaryPdfBlob(
        yearResults.value,
        className,
        yearOpts,
      );
      downloadBlob(blob, `${className}_year_summary.pdf`);
      return;
    }
    const s = summary.value;
    if (!s) return;
    const blob = buildClassSummaryPdfBlob(s, className, reportType.value, selectedTermName);
    downloadBlob(blob, `${className}_summary.pdf`);
  };

  const downloadExamReportPdf = async () => {
    const s = summary.value;
    if (!s) return;
    try {
      const blob = await buildEndOfYearExamPdfBlob(s, {
        className,
        termName: selectedTermName || undefined,
        academicYear: academicYearName.value || undefined,
        scoreField: isYearEnd ? "yearGrade" : "termComposite",
      });
      downloadBlob(blob, `${className}_exam_report.pdf`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate exam report PDF";
      toast.error(msg);
    }
  };

  const downloadCsv = () => {
    if (isYearEnd && yearResults.value.length > 0) {
      const blob = buildYearClassSummaryCsv(
        yearResults.value,
        className,
        yearOpts,
      );
      downloadBlob(blob, `${className}_year_summary.csv`);
      return;
    }
    const s = summary.value;
    if (!s) return;
    const blob = buildClassSummaryCsv(s, className, reportType.value, selectedTermName);
    downloadBlob(blob, `${className}_summary.csv`);
  };

  const downloadXlsx = () => {
    if (isYearEnd && yearResults.value.length > 0) {
      const blob = buildYearClassSummaryXlsx(
        yearResults.value,
        className,
        yearOpts,
      );
      downloadBlob(blob, `${className}_year_summary.xlsx`);
      return;
    }
    const s = summary.value;
    if (!s) return;
    const blob = buildClassSummaryXlsx(s, className, reportType.value, selectedTermName);
    downloadBlob(blob, `${className}_summary.xlsx`);
  };

  const generateAndUploadAll = async () => {
    const s = summary.value;
    if (!s || !classInfo.value?.isClassTeacher) return;

    generating.value = true;
    try {
      let pdfBlob: Blob;
      let csvBlob: Blob;
      let xlsxBlob: Blob;
      const suffix = isYearEnd ? "year_summary" : "summary";

      if (isYearEnd && yearResults.value.length > 0) {
        pdfBlob = buildYearClassSummaryPdfBlob(yearResults.value, className, yearOpts);
        csvBlob = buildYearClassSummaryCsv(yearResults.value, className, yearOpts);
        xlsxBlob = buildYearClassSummaryXlsx(yearResults.value, className, yearOpts);
      } else {
        pdfBlob = buildClassSummaryPdfBlob(s, className, reportType.value, selectedTermName);
        csvBlob = buildClassSummaryCsv(s, className, reportType.value, selectedTermName);
        xlsxBlob = buildClassSummaryXlsx(s, className, reportType.value, selectedTermName);
      }

      downloadBlob(pdfBlob, `${className}_${suffix}.pdf`);
      downloadBlob(csvBlob, `${className}_${suffix}.csv`);
      downloadBlob(xlsxBlob, `${className}_${suffix}.xlsx`);

      await uploadClassSummaryFile(
        classId, selectedTermId.value, reportType.value,
        pdfBlob, "pdf", "class-summary.pdf",
      );
      await uploadClassSummaryFile(
        classId, selectedTermId.value, reportType.value,
        csvBlob, "csv", "class-summary.csv",
      );
      await uploadClassSummaryFile(
        classId, selectedTermId.value, reportType.value,
        xlsxBlob, "xlsx", "class-summary.xlsx",
      );

      const files = await getClassSummaryFiles(
        classId, selectedTermId.value, reportType.value,
      );
      storedFiles.value = files;
      toast.success("All files generated, downloaded, and uploaded");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to generate files";
      toast.error(msg);
    } finally {
      generating.value = false;
    }
  };

  const downloadStoredFile = async (fileType: string) => {
    try {
      const blob = await downloadClassSummaryFile(
        classId, selectedTermId.value, reportType.value, fileType,
      );
      const ext = fileType;
      downloadBlob(blob, `${className}_summary.${ext}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      toast.error(msg);
    }
  };

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!classInfo.value || !classInfo.value.isClassTeacher) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/classes")}
        >
          Back to Classes
        </Button>
        <p className="text-center text-muted-foreground py-12">
          {classInfo.value
            ? "Only the class teacher can view the class report."
            : "Class not found or you don\u2019t have access."}
        </p>
      </div>
    );
  }

  const s = summary.value;
  const isClassTeacher = classInfo.value.isClassTeacher;

  const storedFileTypes = new Set(storedFiles.value.map((f) => f.file_type));

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`${className} · Class Report`}
        description="Class-level statistics, subject averages, and student rankings"
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSummary}
            disabled={dataLoading.value}
          >
            <RefreshCw
              className={`mr-2 size-4 ${dataLoading.value ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Select the term and report type to view statistics.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          {gradingModel.value === "year_based" && (
            <div className="space-y-1.5 min-w-[160px]">
              <label className="text-sm font-medium">Report Type</label>
              <select
                className={selectClass}
                value={reportType.value}
                onChange={(e) => {
                  reportType.value = e.target.value as ReportType;
                }}
              >
                <option value="term">Term</option>
                <option value="year_end">Year-end</option>
              </select>
            </div>
          )}
          {!(gradingModel.value === "year_based" && reportType.value === "year_end") && (
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-sm font-medium">Term</label>
              <select
                className={selectClass}
                value={selectedTermId.value}
                onChange={(e) => {
                  selectedTermId.value = e.target.value;
                }}
              >
                {terms.value.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      {dataLoading.value ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !s || s.totalStudents === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No grade data found for this term. Make sure assessments have been
            entered for students in this class.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Class Average</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {s.classAverage != null ? s.classAverage.toFixed(2) : "-"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Highest / Lowest</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {s.highestAverage != null ? s.highestAverage.toFixed(1) : "-"}
                  {" / "}
                  {s.lowestAverage != null ? s.lowestAverage.toFixed(1) : "-"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  Students ({s.totalStudents})
                </CardDescription>
                <CardTitle className="text-2xl">
                  <span className="text-green-600 dark:text-green-400">
                    {s.passCount} pass
                  </span>
                  {" / "}
                  <span className="text-red-600 dark:text-red-400">
                    {s.failCount} fail
                  </span>
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  {reportType.value === "year_end" && s.gradingModel === "year_based"
                    ? "Year Weights"
                    : "Term Weights"}
                </CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  CW {s.courseworkWeight}% / EX {s.examWeight}%
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {s.subjectAverages.length > 0 && gradingModel.value !== "year_based" && (
            <Card>
              <CardHeader>
                <CardTitle>Subject Averages</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead className="text-right">Average</TableHead>
                      <TableHead className="text-right">Highest</TableHead>
                      <TableHead className="text-right">Lowest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.subjectAverages.map((sub) => (
                      <TableRow key={sub.subjectId}>
                        <TableCell className="font-medium">
                          {sub.subjectName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {sub.average != null ? sub.average.toFixed(2) : "-"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {sub.highestMark != null
                            ? sub.highestMark.toFixed(1)
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {sub.lowestMark != null
                            ? sub.lowestMark.toFixed(1)
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Student Rankings</CardTitle>
              <CardDescription>
                {isYearEnd && yearResults.value.length > 0
                  ? "Ordered by position, based on year-end overall average"
                  : "Ordered by position, based on overall average"}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {isYearEnd && yearResults.value.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">
                        Year Average
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearResults.value.map((yr) => (
                      <TableRow key={yr.studentId}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {yr.position ?? "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {yr.firstName} {yr.lastName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {yr.yearEnd.overallAverage != null
                            ? yr.yearEnd.overallAverage.toFixed(2)
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">
                        Overall Average
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.students.map((st) => (
                      <TableRow key={st.studentId}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {st.position ?? "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {st.firstName} {st.lastName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {st.overallAverage != null
                            ? st.overallAverage.toFixed(2)
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5" />
                Export
              </CardTitle>
              <CardDescription>
                Download locally or generate and upload to storage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={downloadPdf}>
                  <FileText className="mr-2 size-4" />
                  Download PDF
                </Button>
                <Button size="sm" variant="outline" onClick={downloadExamReportPdf}>
                  <FileText className="mr-2 size-4" />
                  Exam Report Card
                </Button>
                <Button size="sm" variant="outline" onClick={downloadCsv}>
                  <FileSpreadsheet className="mr-2 size-4" />
                  Download CSV
                </Button>
                <Button size="sm" variant="outline" onClick={downloadXlsx}>
                  <FileSpreadsheet className="mr-2 size-4" />
                  Download Excel
                </Button>
              </div>

              {isClassTeacher && (
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    onClick={generateAndUploadAll}
                    disabled={generating.value}
                  >
                    <Upload className="mr-2 size-4" />
                    {generating.value
                      ? "Working…"
                      : "Generate & save all to storage"}
                  </Button>
                </div>
              )}

              {storedFiles.value.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">Stored files</p>
                  <ul className="space-y-2 text-sm">
                    {storedFiles.value.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs uppercase">
                              {f.file_type}
                            </Badge>
                            <code className="text-xs break-all">
                              {f.file_path}
                            </code>
                          </div>
                          <span className="text-muted-foreground">
                            {(f.file_size / 1024).toFixed(1)} KB ·{" "}
                            {new Date(f.generated_at).toLocaleString()}
                          </span>
                        </div>
                        {storedFileTypes.has(f.file_type) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => downloadStoredFile(f.file_type)}
                          >
                            <Download className="size-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
