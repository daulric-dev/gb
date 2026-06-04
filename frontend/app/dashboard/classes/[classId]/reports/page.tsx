"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  type ReportType,
  getClassTermResults,
  getClassYearResults,
  type StudentTermResult,
  type StudentYearReport,
} from "@/lib/reports";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import { FileBarChart, RefreshCw } from "lucide-react";
import { type ClassInfo, type Term, type StudentRow } from "./_components/types";
import { ReportsLoadingSkeleton } from "./_components/ReportsLoadingSkeleton";
import { ReportsAccessDenied } from "./_components/ReportsAccessDenied";
import { ReportsFiltersCard } from "./_components/ReportsFiltersCard";
import { StudentsTableCard } from "./_components/StudentsTableCard";

export default function ClassReportsPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params?.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const terms = useSignal<Term[]>([]);
  const selectedTermId = useSignal("");
  const gradingModel = useSignal<string>("weighted_continuous");
  const reportType = useSignal<ReportType>("term");
  const students = useSignal<StudentRow[]>([]);
  const loading = useSignal(true);
  const dataLoading = useSignal(false);

  const loadClass = useCallback(() => {
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
              gradingModel.value = ay.grading_model ?? "weighted_continuous";
            })
            .catch(() => {});

          api<Term[]>(`/terms?yearId=${info.academicYearId}`)
            .then((t) => {
              terms.value = t;
              if (t.length > 0 && !selectedTermId.value) {
                selectedTermId.value = t[0].id;
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

  const fetchGrades = useCallback(() => {
    if (!selectedTermId.value) {
      students.value = [];
      return;
    }
    dataLoading.value = true;

    const isYearEnd = reportType.value === "year_end";

    const calcPromise: Promise<
      StudentTermResult[] | StudentYearReport[]
    > = isYearEnd && classInfo.value?.academicYearId
      ? getClassYearResults(classInfo.value.academicYearId, classId)
      : getClassTermResults(selectedTermId.value, classId);

    calcPromise
      .then((calcData) => {
        let rows: StudentRow[];

        if (isYearEnd) {
          const yearData = calcData as StudentYearReport[];
          rows = yearData.map((yr) => ({
            studentId: yr.studentId,
            firstName: yr.firstName,
            lastName: yr.lastName,
            overallAverage: yr.yearEnd.overallAverage,
            position: yr.position,
          }));
        } else {
          const termData = calcData as StudentTermResult[];
          rows = termData.map((tr) => ({
            studentId: tr.studentId,
            firstName: tr.firstName,
            lastName: tr.lastName,
            overallAverage: tr.overallAverage,
            position: tr.position,
          }));
        }

        rows.sort((a, b) => {
          const pa = a.position ?? 9999;
          const pb = b.position ?? 9999;
          return pa - pb;
        });

        students.value = rows;
      })
      .catch((e) => {
        students.value = [];
        const msg =
          e instanceof ApiError ? e.message : "Failed to load grades";
        toast.error(msg);
      })
      .finally(() => {
        dataLoading.value = false;
      });
  }, [
    classId,
    selectedTermId.value,
    reportType.value,
    gradingModel.value,
    classInfo.value?.academicYearId,
  ]);

  useEffect(() => {
    fetchGrades();
  }, [fetchGrades]);

  if (loading.value) {
    return <ReportsLoadingSkeleton />;
  }

  if (!classInfo.value || !classInfo.value.isClassTeacher) {
    return (
      <ReportsAccessDenied
        classInfo={classInfo.value}
        onBack={() => router.push("/dashboard/classes")}
      />
    );
  }

  const info = classInfo.value;

  const studentDetailQuery = (studentId: string) => {
    const q = new URLSearchParams({
      studentId,
      termId: selectedTermId.value,
      reportType: reportType.value,
    });
    return `/dashboard/classes/${classId}/reports/student?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`${info.name} · Reports`}
        description="Live calculated grades from assessments"
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/dashboard/classes/${classId}/class-report`)
              }
            >
              <FileBarChart className="mr-2 size-4" />
              Class Report
            </Button>
            <Button
              variant="outline"
              onClick={() => fetchGrades()}
              disabled={dataLoading.value}
            >
              <RefreshCw
                className={`mr-2 size-4 ${dataLoading.value ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        }
      />

      <ReportsFiltersCard
        reportType={reportType.value}
        onReportTypeChange={(v) => {
          reportType.value = v;
        }}
        terms={terms.value}
        selectedTermId={selectedTermId.value}
        onTermChange={(v) => {
          selectedTermId.value = v;
        }}
      />

      <StudentsTableCard
        students={students.value}
        dataLoading={dataLoading.value}
        studentDetailHref={studentDetailQuery}
      />
    </div>
  );
}
