"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  generateReports,
  listReportsForClassTerm,
  type ReportBookListItem,
  type ReportType,
} from "@/lib/reports";
import {
  getClassTermResults,
  getClassYearResults,
  type StudentTermResult,
  type StudentYearReport,
} from "@/lib/year-report";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/back-title-toolbar";
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
import { ArrowLeft, FileBarChart, FileText, RefreshCw } from "lucide-react";

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
}

interface MergedStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  overallAverage: number | null;
  position: number | undefined;
  reportId: string | null;
  reportStatus: string | null;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function statusBadge(status: string | null) {
  switch (status) {
    case "published":
      return <Badge variant="default">Published</Badge>;
    case "sent_to_ministry":
      return <Badge variant="secondary">Sent to ministry</Badge>;
    case "draft":
      return <Badge variant="outline">Draft</Badge>;
    default:
      return null;
  }
}

export default function ClassReportsPage() {
  useSignals();
  const params = useParams();
  const router = useRouter();
  const classId = params.classId as string;

  const classInfo = useSignal<ClassInfo | null>(null);
  const terms = useSignal<Term[]>([]);
  const selectedTermId = useSignal("");
  const gradingModel = useSignal<"term_based" | "year_based">("term_based");
  const reportType = useSignal<ReportType>("term");
  const students = useSignal<MergedStudent[]>([]);
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
          api<{ grading_model?: string }>(
            `/academic-years/${info.academicYearId}`,
          )
            .then((ay) => {
              const model =
                ay.grading_model === "year_based" ? "year_based" : "term_based";
              gradingModel.value = model;
              if (model === "term_based") {
                reportType.value = "term";
              }
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

    const isYearEnd =
      reportType.value === "year_end" && gradingModel.value === "year_based";

    const calcPromise: Promise<
      StudentTermResult[] | StudentYearReport[]
    > = isYearEnd && classInfo.value?.academicYearId
      ? getClassYearResults(classInfo.value.academicYearId, classId)
      : getClassTermResults(selectedTermId.value, classId);

    const reportsPromise = listReportsForClassTerm(
      classId,
      selectedTermId.value,
      reportType.value,
    ).catch(() => [] as ReportBookListItem[]);

    Promise.all([calcPromise, reportsPromise])
      .then(([calcData, reports]) => {
        const reportMap = new Map<string, ReportBookListItem>();
        for (const r of reports) {
          if (r.student_id) reportMap.set(r.student_id, r);
        }

        let merged: MergedStudent[];

        if (isYearEnd) {
          const yearData = calcData as StudentYearReport[];
          merged = yearData.map((yr) => {
            const existing = reportMap.get(yr.studentId);
            return {
              studentId: yr.studentId,
              firstName: yr.firstName,
              lastName: yr.lastName,
              overallAverage: yr.yearEnd.overallAverage,
              position: yr.position,
              reportId: existing?.id ?? null,
              reportStatus: existing?.status ?? null,
            };
          });
        } else {
          const termData = calcData as StudentTermResult[];
          merged = termData.map((tr) => {
            const existing = reportMap.get(tr.studentId);
            return {
              studentId: tr.studentId,
              firstName: tr.firstName,
              lastName: tr.lastName,
              overallAverage: tr.overallAverage,
              position: tr.position,
              reportId: existing?.id ?? null,
              reportStatus: existing?.status ?? null,
            };
          });
        }

        merged.sort((a, b) => {
          const pa = a.position ?? 9999;
          const pb = b.position ?? 9999;
          return pa - pb;
        });

        students.value = merged;
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

  const handleGenerate = async () => {
    if (!selectedTermId.value) {
      toast.error("Select a term");
      return;
    }
    generating.value = true;
    try {
      const res = await generateReports({
        termId: selectedTermId.value,
        studentGroupId: classId,
        reportType: reportType.value,
      });
      toast.success(res.message || `Generated ${res.generated} report(s)`);
      fetchGrades();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Generation failed";
      toast.error(msg);
    } finally {
      generating.value = false;
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
          <ArrowLeft className="mr-2 size-4" /> Back to Classes
        </Button>
        <p className="text-center text-muted-foreground py-12">
          {classInfo.value
            ? "Only the class teacher can view reports."
            : "Class not found or you don\u2019t have access."}
        </p>
      </div>
    );
  }

  const info = classInfo.value;
  const hasAnyReports = students.value.some((s) => s.reportId);

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`${info.name} · Reports`}
        description="Live calculated grades and report management"
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
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
          {gradingModel.value === "year_based" && (
            <div className="space-y-1.5 min-w-[160px]">
              <label className="text-sm font-medium">Report type</label>
              <select
                className={selectClass}
                value={reportType.value}
                onChange={(e) => {
                  reportType.value = e.target.value as ReportType;
                }}
              >
                <option value="term">Term</option>
                <option value="year_end">Year-End</option>
              </select>
            </div>
          )}
          {info.isClassTeacher && (
            <Button
              variant="outline"
              onClick={handleGenerate}
              disabled={generating.value || !selectedTermId.value}
            >
              {generating.value
                ? "Generating…"
                : hasAnyReports
                  ? "Regenerate Reports"
                  : "Generate Reports"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
          <CardDescription>
            Grades are calculated live. Generate reports to enable remarks, PDF
            export, and ministry submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dataLoading.value ? (
            <Skeleton className="h-48 w-full" />
          ) : students.value.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No students or grades found for this term.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.value.map((s) => (
                  <TableRow key={s.studentId}>
                    <TableCell className="text-muted-foreground">
                      {s.position ?? "-"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {s.firstName} {s.lastName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.overallAverage != null
                        ? s.overallAverage.toFixed(2)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {s.reportId ? (
                        statusBadge(s.reportStatus)
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not generated
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.reportId ? (
                        <Link
                          href={`/dashboard/classes/${classId}/reports/${s.reportId}`}
                          className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
