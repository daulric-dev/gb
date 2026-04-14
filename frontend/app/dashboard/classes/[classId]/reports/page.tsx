"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { generateReports, type ReportBookListItem, type ReportType } from "@/lib/reports";
import { listReportsForClassTerm } from "@/lib/reports";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BackTitleToolbar } from "@/components/back-title-toolbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react";

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

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function statusBadge(status: string | null) {
  switch (status) {
    case "published":
      return <Badge variant="default">Published</Badge>;
    case "sent_to_ministry":
      return <Badge variant="secondary">Sent to ministry</Badge>;
    default:
      return <Badge variant="outline">Draft</Badge>;
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
  const reportType = useSignal<ReportType>("term");
  const rows = useSignal<ReportBookListItem[]>([]);
  const loading = useSignal(true);
  const listLoading = useSignal(false);
  const generating = useSignal(false);

  const loadClass = useCallback(() => {
    loading.value = true;
    api<ClassInfo[]>("/classes")
      .then((list) => {
        const info = list.find((c) => c.id === classId) ?? null;
        classInfo.value = info;
        if (info?.academicYearId) {
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

  const fetchReports = useCallback(() => {
    if (!selectedTermId.value) {
      rows.value = [];
      return;
    }
    listLoading.value = true;
    listReportsForClassTerm(classId, selectedTermId.value)
      .then((data) => {
        rows.value = data.filter((r) => r.report_type === reportType.value);
      })
      .catch((e) => {
        rows.value = [];
        const msg = e instanceof ApiError ? e.message : "Failed to load reports";
        toast.error(msg);
      })
      .finally(() => {
        listLoading.value = false;
      });
  }, [classId, selectedTermId.value, reportType.value]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

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
      fetchReports();
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

  if (!classInfo.value) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/classes")}>
          <ArrowLeft className="mr-2 size-4" /> Back to Classes
        </Button>
        <p className="text-center text-muted-foreground py-12">
          Class not found or you don&apos;t have access.
        </p>
      </div>
    );
  }

  const info = classInfo.value;

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={`${info.name} · Reports`}
        description="Term report cards, remarks, and PDF history"
        onBack={() => router.push(`/dashboard/classes/${classId}`)}
        actions={
          <Button variant="outline" onClick={() => fetchReports()} disabled={listLoading.value}>
            <RefreshCw className={`mr-2 size-4 ${listLoading.value ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Filters &amp; generation
          </CardTitle>
          <CardDescription>
            Choose term and report type, then generate or refresh the list. Generation updates
            calculated grades; existing teacher remarks are preserved where the API allows.
          </CardDescription>
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
              <option value="year_end">Year-end</option>
            </select>
          </div>
          {info.isClassTeacher && (
            <Button onClick={handleGenerate} disabled={generating.value || !selectedTermId.value}>
              {generating.value ? "Generating…" : "Generate / update reports"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
          <CardDescription>
            Ordered by position. Open a row for remarks, status, and PDF tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listLoading.value ? (
            <Skeleton className="h-48 w-full" />
          ) : rows.value.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No reports for this term and type yet.
              {info.isClassTeacher && " Use “Generate / update reports” to create them."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.value.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">
                      {r.position ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.student
                        ? `${r.student.first_name} ${r.student.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.overall_average != null ? r.overall_average.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/dashboard/classes/${classId}/reports/${r.id}`}
                        className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
                      >
                        Open
                      </Link>
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
