"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { MyOutcomes } from "@/lib/mastery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OutcomeProgressList, ScaleLegend } from "@/components/mastery/mastery-ui";
import { EmptyState } from "../_components/portal-ui";

/** The student's mastery of each course's learning outcomes, with the evidence behind it. */
export default function PortalOutcomesPage() {
  useSignals();
  const data = useSignal<MyOutcomes | null>(null);

  useEffect(() => {
    api<MyOutcomes>("/portal/me/outcomes")
      .then((d) => (data.value = d))
      .catch((err) => {
        data.value = null;
        toast.error(userMessage(err, "Failed to load your outcomes"));
      });
  }, [data]);

  const d = data.value;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Outcomes</h1>
        <p className="mt-1 text-muted-foreground">
          How you are doing on each learning outcome, from your marked work. This is alongside your grades and does not
          change them.
        </p>
      </div>
      {!d ? (
        <Skeleton className="h-48 w-full" />
      ) : d.courses.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No outcomes yet"
          description="When your teachers link outcomes to your work, your progress shows here."
        />
      ) : (
        <>
          <ScaleLegend scale={d.scale} />
          {d.courses.map((c) => (
            <Card key={c.courseId}>
              <CardHeader>
                <CardTitle>
                  <h2>{c.courseCode ? `${c.courseName} (${c.courseCode})` : c.courseName}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <OutcomeProgressList outcomes={c.outcomes} scale={d.scale} />
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
