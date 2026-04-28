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
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";

import type { ClassInfo, Term } from "./_components/types";
import { LoadingSkeleton } from "./_components/LoadingSkeleton";
import { AccessDenied } from "./_components/AccessDenied";
import { FiltersCard } from "./_components/FiltersCard";
import { StatsSummaryCards } from "./_components/StatsSummaryCards";
import { SubjectAveragesCard } from "./_components/SubjectAveragesCard";
import { StudentRankingsCard } from "./_components/StudentRankingsCard";
import { ExportCard } from "./_components/ExportCard";

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
    return <LoadingSkeleton />;
  }

  if (!classInfo.value || !classInfo.value.isClassTeacher) {
    return <AccessDenied classInfo={classInfo.value} />;
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

      <FiltersCard
        gradingModel={gradingModel.value}
        reportType={reportType.value}
        onReportTypeChange={(v) => { reportType.value = v; }}
        selectedTermId={selectedTermId.value}
        onTermChange={(v) => { selectedTermId.value = v; }}
        terms={terms.value}
      />

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
          <StatsSummaryCards summary={s} reportType={reportType.value} />

          {s.subjectAverages.length > 0 && gradingModel.value !== "year_based" && (
            <SubjectAveragesCard subjectAverages={s.subjectAverages} />
          )}

          <StudentRankingsCard
            isYearEnd={isYearEnd}
            yearResults={yearResults.value}
            students={s.students}
          />

          <ExportCard
            isClassTeacher={isClassTeacher}
            generating={generating.value}
            storedFiles={storedFiles.value}
            storedFileTypes={storedFileTypes}
            onDownloadPdf={downloadPdf}
            onDownloadExamReportPdf={downloadExamReportPdf}
            onDownloadCsv={downloadCsv}
            onDownloadXlsx={downloadXlsx}
            onGenerateAndUploadAll={generateAndUploadAll}
            onDownloadStoredFile={downloadStoredFile}
          />
        </>
      )}
    </div>
  );
}
