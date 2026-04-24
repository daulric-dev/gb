"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
import { ArrowLeft, Download, FileText, RefreshCw } from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

const fmtNum = (v: number | null) => (v != null ? v.toFixed(1) : "-");

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
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!classInfo.value || !classInfo.value.isClassTeacher) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/dashboard/classes/${classId}/reports`)
          }
        >
          <ArrowLeft className="mr-2 size-4" /> Back
        </Button>
        <p className="text-muted-foreground py-8 text-center">
          {classInfo.value && !classInfo.value.isClassTeacher
            ? "Only the class teacher can view this report."
            : "Class not found."}
        </p>
      </div>
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
            {(tr?.position != null) && (
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
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No calculated grades found for this student. Make sure assessments
            have been entered.
          </CardContent>
        </Card>
      ) : isYearEnd && yr ? (
        <Card>
          <CardHeader>
            <CardTitle>Year-End Subject Results</CardTitle>
            <CardDescription>
              Each term composite and year grade, calculated live from
              assessments.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  {yr.terms.map((t) => (
                    <TableHead
                      key={t.termId}
                      className="text-right"
                      title={t.termName}
                    >
                      {t.termName.charAt(0).toUpperCase()}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">End of Yr Exam</TableHead>
                  <TableHead className="text-right">Year Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yr.yearEnd.subjects.map((sub) => {
                  const lastTerm = yr.terms[yr.terms.length - 1];
                  const lastTermSubject = lastTerm?.subjects.find(
                    (s) => s.subjectId === sub.subjectId,
                  );
                  return (
                    <TableRow key={sub.subjectId}>
                      <TableCell className="font-medium">
                        {sub.subjectName}
                      </TableCell>
                      {yr.terms.map((t) => {
                        const tg = sub.termGrades.find(
                          (g) => g.termId === t.termId,
                        );
                        return (
                          <TableCell
                            key={t.termId}
                            className="text-right tabular-nums text-muted-foreground"
                          >
                            {fmtNum(tg?.termComposite ?? null)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtNum(lastTermSubject?.examAverage ?? null)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtNum(sub.yearGrade)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : tr ? (
        <Card>
          <CardHeader>
            <CardTitle>Subject Results</CardTitle>
            <CardDescription>
              Live calculated grades from assessments.
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {tr.subjects.map((sub) => (
                  <TableRow key={sub.subjectId}>
                    <TableCell className="font-medium">
                      {sub.subjectName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtNum(sub.courseworkAverage)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtNum(sub.examAverage)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(sub.termComposite)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {hasData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-5" />
              Export
            </CardTitle>
            <CardDescription>
              Download this student&apos;s report as a PDF.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadPdf}>
              <Download className="mr-2 size-4" />
              Download PDF
            </Button>
            {tr && (
              <Button size="sm" onClick={downloadReportCard}>
                <FileText className="mr-2 size-4" />
                Report Card
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}