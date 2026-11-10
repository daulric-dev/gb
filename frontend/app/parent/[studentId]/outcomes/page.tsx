"use client";

import { useParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import type { MyOutcomes } from "@/lib/mastery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OutcomeProgressList, ScaleLegend } from "@/components/mastery/mastery-ui";
import { useChildData } from "../../_components/use-child-data";
import { Loading, Notice } from "../../_components/ui";

/**
 * The child's mastery of learning outcomes. Shown only when the school
 * turns on "Mastery of learning outcomes" for parents (off by default) and
 * the mastery feature is on; the API answers 403 otherwise.
 */
export default function ParentOutcomesPage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const outcomes = useChildData<MyOutcomes>(`/parent/children/${studentId}/outcomes`);

  if (outcomes.loading.value) return <Loading />;
  if (outcomes.error.value) return <Notice>{outcomes.error.value}</Notice>;
  const d = outcomes.data.value;
  if (!d || d.courses.length === 0) return <Notice>No outcomes are tracked yet.</Notice>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Outcomes</h1>
      <ScaleLegend scale={d.scale} />
      {d.courses.map((c) => (
        <Card key={c.courseId}>
          <CardHeader>
            <CardTitle>
              <h2>{c.courseName}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OutcomeProgressList outcomes={c.outcomes} scale={d.scale} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
