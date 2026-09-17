"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  termLabel,
  type PortalSubjectGrades,
} from "../_components/types";

function percent(score: number | null, maxScore: number | null) {
  if (score === null || maxScore === null || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

export default function PortalGradesPage() {
  useSignals();

  const subjects = useSignal<PortalSubjectGrades[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    api<PortalSubjectGrades[]>("/portal/me/grades")
      .then((data) => (subjects.value = data))
      .catch(() => (subjects.value = []))
      .finally(() => (loading.value = false));
  }, [subjects, loading]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Grades</h1>
        <p className="mt-1 text-muted-foreground">
          Your marks, grouped by subject
        </p>
      </div>

      {subjects.value.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No grades have been recorded yet.
          </CardContent>
        </Card>
      ) : (
        subjects.value.map((subject) => (
          <Card key={subject.subject?.id ?? "unknown"}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {subject.subject?.name ?? "Unassigned subject"}
                  {subject.subject?.code && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {subject.subject.code}
                    </span>
                  )}
                </CardTitle>
                {subject.average !== null && (
                  <Badge variant="secondary">Average {subject.average}%</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subject.assessments.map((a) => {
                    const pct = percent(a.score, a.maxScore);
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <span className="font-medium">{a.title}</span>
                          {a.type && (
                            <span className="ml-2 text-xs capitalize text-muted-foreground">
                              {a.type}
                            </span>
                          )}
                          {a.remarks && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {a.remarks}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {termLabel(a.term?.name)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(a.date)}
                        </TableCell>
                        <TableCell className="text-right">
                          {a.score === null ? (
                            <span className="text-sm text-muted-foreground">
                              Not marked
                            </span>
                          ) : (
                            <span className="font-medium">
                              {a.score}
                              {a.maxScore !== null && (
                                <span className="text-muted-foreground">
                                  /{a.maxScore}
                                </span>
                              )}
                              {pct !== null && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {pct}%
                                </span>
                              )}
                            </span>
                          )}
                          {a.letterGrade && (
                            <Badge variant="outline" className="ml-2">
                              {a.letterGrade}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
