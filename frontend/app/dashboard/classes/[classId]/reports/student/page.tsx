"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type ReportType,
  buildReportPdfBlob,
  downloadBlob,
  buildYearReportPdfBlob,
  yearReportPdfFilename,
  getStudentTermResult,
  getStudentYearResult,
  type StudentTermResult,
  type StudentYearReport,
  buildStudentReportPdfBlob,
} from "@/lib/reports";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { RefreshCw } from "lucide-react";
import { type ClassInfo } from "./_components/types";
import { StudentReportLoadingSkeleton } from "./_components/StudentReportLoadingSkeleton";
import { StudentReportAccessDenied } from "./_components/StudentReportAccessDenied";
import { NoGradesCard } from "./_components/NoGradesCard";
import { YearEndResultsCard } from "./_components/YearEndResultsCard";
import { TermResultsCard } from "./_components/TermResultsCard";
import { ExportCard } from "./_components/ExportCard";

export default function StudentReportPage() {
  useSignals();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const classId = params?.classId as string;
  const studentId = searchParams?.get("studentId") ?? "";
  const termId = searchParams?.get("termId") ?? "";
  const reportType = (searchParams?.get("reportType") ?? "term") as ReportType;

  const classInfo = useSignal<ClassInfo | null>(null);
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const termResult = useSignal<StudentTermResult | null>(null);
  const yearResult = useSignal<StudentYearReport | null>(null);
  const termName = useSignal("");
  const loading = useSignal(true);

  const loadContext = useCallback(() => {
    loading.value = true;
    api<ClassInfo[]>("/classes")
      .then((list) => {
        const info = list.find((c) => c.id === classId) ?? null;
        classInfo.value = info;
        if (info?.academicYearId) {
          api<{ grading_model?: string }>(
            `/academic-years/${info.academicYearId}`,
          )
            .then((ay) => {
              const model =
                ay.grading_model === "year_based" ? "year_based" : "term_based";
              gradingModel.value = model;
            })
            .catch(() => {});

          api<{ id: string; name: string }[]>(
            `/terms?yearId=${info.academicYearId}`,
          )
            .then((terms) => {
              const match = terms.find((t) => t.id === termId);
              if (match) termName.value = match.name;
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        classInfo.value = null;
      })
      .finally(() => {
        loading.value = false;
      });
  }, [classId, termId]);

  const fetchCalc = useCallback(() => {
    if (!studentId || !termId) return;

    getStudentTermResult(studentId, termId, classId)
      .then((tr) => {
        termResult.value = tr;
      })
      .catch(() => {
        termResult.value = null;
      });

    const info = classInfo.value;
    if (
      gradingModel.value === "year_based" &&
      reportType === "year_end" &&
      info?.academicYearId
    ) {
      getStudentYearResult(studentId, info.academicYearId, classId)
        .then((yr) => {
          yearResult.value = yr;
        })
        .catch(() => {
          yearResult.value = null;
        });
    }
  }, [studentId, termId, classId, gradingModel.value, classInfo.value?.academicYearId, reportType]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    fetchCalc();
  }, [fetchCalc]);

  const tr = termResult.value;
  const yr = yearResult.value;
  const isYearEnd =
    gradingModel.value === "year_based" && reportType === "year_end" && !!yr;

  const studentName = tr
    ? `${tr.firstName} ${tr.lastName}`
    : yr
      ? `${yr.firstName} ${yr.lastName}`
      : "Student";

  const downloadPdf = () => {
    if (isYearEnd && yr) {
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

    if (tr) {
      try {
        const blob = buildReportPdfBlob(tr, {
          termName: termName.value || undefined,
        });
        const safeName = `${tr.firstName}_${tr.lastName}`.replace(/\s+/g, "_");
        downloadBlob(blob, `${safeName}_report.pdf`);
        toast.success("PDF downloaded");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not generate PDF";
        toast.error(msg);
      }
    } else {
      toast.error("No calculated grades available for PDF");
    }
  };

  const downloadReportCard = async () => {
    if (!tr) {
      toast.error("No calculated grades available");
      return;
    }
    try {
      const blob = await buildStudentReportPdfBlob(tr, {
        termName: termName.value || undefined,
        className: classInfo.value?.name,
      });
      const safeName = `${tr.firstName}_${tr.lastName}`.replace(/\s+/g, "_");
      downloadBlob(blob, `${safeName}_report_card.pdf`);
      toast.success("Report card downloaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not generate report card";
      toast.error(msg);
    }
  };

  if (loading.value) {
    return <StudentReportLoadingSkeleton />;
  }

  if (!classInfo.value || !classInfo.value.isClassTeacher) {
    return (
      <StudentReportAccessDenied
        classInfo={classInfo.value}
        onBack={() => router.push(`/dashboard/classes/${classId}/reports`)}
      />
    );
  }

  const hasData = !!tr || !!yr;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={studentName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {termName.value && (
              <span className="text-muted-foreground text-sm">
                {termName.value}
              </span>
            )}
            {tr?.position != null && (
              <span className="text-muted-foreground text-sm">
                Rank {tr.position}
              </span>
            )}
            {isYearEnd && yr?.position != null && (
              <span className="text-muted-foreground text-sm">
                Rank {yr.position}
              </span>
            )}
          </span>
        }
        onBack={() =>
          router.push(`/dashboard/classes/${classId}/reports`)
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCalc}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Refresh
          </Button>
        }
      />

      {!hasData ? (
        <NoGradesCard />
      ) : isYearEnd && yr ? (
        <YearEndResultsCard yr={yr} />
      ) : tr ? (
        <TermResultsCard tr={tr} />
      ) : null}

      {hasData && (
        <ExportCard
          tr={tr}
          onDownloadPdf={downloadPdf}
          onDownloadReportCard={downloadReportCard}
        />
      )}
    </div>
  );
}
