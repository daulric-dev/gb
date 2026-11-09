"use client";

import { useParams } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { gradeText, type ParentCourse, type ParentCourseGrades } from "@/lib/parent";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useChildData } from "../../_components/use-child-data";
import { formatWhen, Loading, Notice } from "../../_components/ui";

type Detail =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: ParentCourseGrades };

const STATUS: Record<ParentCourseGrades["activities"][number]["status"], string> = {
  graded: "Marked",
  submitted: "Handed in",
  excused: "Excused",
  not_submitted: "Not handed in",
};

/** Current grade per course; a course opens to its marked work. */
export default function ParentGradesPage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const courses = useChildData<ParentCourse[]>(`/parent/children/${studentId}/courses`);
  const details = useSignal<Record<string, Detail>>({});

  function open(courseId: string) {
    if (details.value[courseId]) return;
    details.value = { ...details.value, [courseId]: { state: "loading" } };
    api<ParentCourseGrades>(`/parent/children/${studentId}/courses/${courseId}/grades`)
      .then((data) => (details.value = { ...details.value, [courseId]: { state: "ready", data } }))
      .catch(
        (err) =>
          (details.value = {
            ...details.value,
            [courseId]: { state: "error", message: userMessage(err, "Grades could not be loaded") },
          }),
      );
  }

  if (courses.loading.value) return <Loading />;
  if (courses.error.value) return <Notice>{courses.error.value}</Notice>;
  const list = courses.data.value ?? [];
  if (list.length === 0) return <Notice>Not enrolled in any course yet.</Notice>;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Grades</h1>
      {list.map((c) => {
        const d = details.value[c.id];
        return (
          <Collapsible key={c.id} onOpenChange={(o) => o && open(c.id)}>
            <Card>
              <CollapsibleTrigger className="flex w-full items-center gap-3 p-4 text-left">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  {c.status === "archived" && <p className="text-xs text-muted-foreground">Finished</p>}
                </div>
                <span className="text-sm">{gradeText(c.grade)}</span>
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  {!d || d.state === "loading" ? (
                    <Loading />
                  ) : d.state === "error" ? (
                    <p className="text-sm text-muted-foreground">{d.message}</p>
                  ) : d.data.activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No work yet.</p>
                  ) : (
                    <ul className="divide-y">
                      {d.data.activities.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{a.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {a.groupName ?? "Ungrouped"} · {a.dueAt ? `due ${formatWhen(a.dueAt)}` : "no due date"}
                              {a.dropped ? " · dropped" : ""}
                            </p>
                          </div>
                          {a.score !== null && (
                            <span className="text-sm tabular-nums">
                              {a.score} / {a.points}
                            </span>
                          )}
                          <Badge variant="outline">{STATUS[a.status]}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </div>
  );
}
