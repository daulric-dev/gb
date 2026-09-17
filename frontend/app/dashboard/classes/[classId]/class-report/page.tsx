"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  getClassSummaryFiles,
  downloadClassSummaryFile,
  downloadFromUrl,
  downloadBlob,
  type ClassSummary,
  type ClassReportFile,
  type ReportType,
  getClassTermResults,
  getClassYearResults,
  termResultsToClassSummary,
  type StudentYearReport,
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
  const gradingModel = useSignal<string>("weighted_continuous");
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
              gradingModel.value = ay.grading_model ?? "weighted_continuous";
              academicYearName.value = ay.name ?? "";
              yearCwWeight.value = ay.year_coursework_weight ?? null;
              yearExWeight.value = ay.year_exam_weight ?? null;
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

    const isYearEnd = reportType.value === "year_end";

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
  const isYearEnd = reportType.value === "year_end";

  const summarySuffix = isYearEnd ? "year_summary" : "summary";

  const summaryUrl = (format: "pdf" | "csv" | "xlsx") => {
    const q = new URLSearchParams({
      studentGroupId: classId,
      termId: selectedTermId.value,
      reportType: reportType.value,
      format,
    });
    return `/reports/files/class-summary?${q.toString()}`;
  };

  const downloadSummary = async (format: "pdf" | "csv" | "xlsx") => {
    try {
      await downloadFromUrl(
        summaryUrl(format),
        `${className}_${summarySuffix}.${format}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  const downloadPdf = () => downloadSummary("pdf");
  const downloadCsv = () => downloadSummary("csv");
  const downloadXlsx = () => downloadSummary("xlsx");

  const downloadExamReportPdf = async () => {
    try {
      const q = new URLSearchParams({
        studentGroupId: classId,
        termId: selectedTermId.value,
        reportType: reportType.value,
      });
      await downloadFromUrl(
        `/reports/files/exam-report.pdf?${q.toString()}`,
        `${className}_exam_report.pdf`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to download exam report PDF",
      );
    }
  };

  const generateAndUploadAll = async () => {
    if (!classInfo.value?.isClassTeacher) return;

    generating.value = true;
    try {
      await api("/reports/files/class-summary/persist", {
        method: "POST",
        body: {
          studentGroupId: classId,
          termId: selectedTermId.value,
          reportType: reportType.value,
        },
      });

      const files = await getClassSummaryFiles(
        classId,
        selectedTermId.value,
        reportType.value,
      );
      storedFiles.value = files;
      toast.success("All files generated and saved to storage");
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

          {s.subjectAverages.length > 0 && !isYearEnd && (
            <SubjectAveragesCard subjectAverages={s.subjectAverages} />
          )}

          <StudentRankingsCard
            isYearEnd={isYearEnd}
            yearResults={yearResults.value}
            students={s.students}
            gradingModel={gradingModel.value}
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
