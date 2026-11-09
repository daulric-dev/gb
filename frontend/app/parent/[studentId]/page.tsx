"use client";

import { useParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { gradeText, personName, type ParentOverview, type ParentWork } from "@/lib/parent";
import { useChildData } from "../_components/use-child-data";
import { Loading, Notice, WorkList } from "../_components/ui";

/** One child at a glance: courses (with grades if shown) and work. */
export default function ParentChildOverviewPage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const overview = useChildData<ParentOverview>(`/parent/children/${studentId}`);
  const showWork = overview.data.value?.visibility.work ?? false;
  const work = useChildData<ParentWork>(showWork ? `/parent/children/${studentId}/work` : null);

  if (overview.loading.value) return <Loading />;
  if (overview.error.value || !overview.data.value) {
    return <Notice>{overview.error.value ?? "This could not be loaded"}</Notice>;
  }
  const o = overview.data.value;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{personName(o.child, "Your child")}</h1>
        <p className="text-sm text-muted-foreground">{o.school?.name}</p>
      </div>

      {showWork && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-2xl font-semibold tabular-nums">{o.missingCount ?? 0}</p>
              <p className="text-sm text-muted-foreground">Missing</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-2xl font-semibold tabular-nums">{o.upcomingCount ?? 0}</p>
              <p className="text-sm text-muted-foreground">Upcoming</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Courses</CardTitle>
        </CardHeader>
        <CardContent>
          {o.courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enrolled in any course yet.</p>
          ) : (
            <ul className="divide-y">
              {o.courses.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.teachers.map((t) => personName(t)).filter(Boolean).join(", ") || "No teacher listed"}
                    </p>
                  </div>
                  {o.visibility.grades && <span className="text-sm">{gradeText(c.grade)}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showWork && (
        <section className="space-y-4">
          {work.loading.value ? (
            <Loading />
          ) : work.error.value ? (
            <Notice>{work.error.value}</Notice>
          ) : (
            <>
              <div className="space-y-2">
                <h2 className="text-base font-semibold">Missing work</h2>
                <WorkList items={work.data.value?.missing ?? []} empty="Nothing missing." />
              </div>
              <div className="space-y-2">
                <h2 className="text-base font-semibold">Upcoming work</h2>
                <WorkList items={work.data.value?.upcoming ?? []} empty="Nothing due." />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
