"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { StudentMastery } from "@/lib/mastery";
import { Skeleton } from "@/components/ui/skeleton";
import { OutcomeProgressList, ScaleLegend } from "@/components/mastery/mastery-ui";
import { useCourse } from "../../../_components/course-context";
import { SectionHeader } from "../../../_components/SectionHeader";

/** One student's mastery in this course, with the evidence behind each outcome. */
export default function StudentMasteryPage() {
  useSignals();
  const { course, base } = useCourse();
  const params = useParams<{ studentId: string }>();
  const studentId = params?.studentId ?? "";
  const data = useSignal<StudentMastery | null>(null);

  useEffect(() => {
    if (!studentId) return;
    api<StudentMastery>(`/courses/${course.id}/mastery/students/${studentId}`)
      .then((d) => (data.value = d))
      .catch((err) => toast.error(userMessage(err, "Failed to load this student's mastery")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, studentId]);

  const d = data.value;
  const name = d ? [d.student.firstName, d.student.lastName].filter(Boolean).join(" ") || "Student" : "Student";
  return (
    <div className="space-y-6">
      <Link href={`${base}/outcomes`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Mastery grid
      </Link>
      <SectionHeader title={name} description="Mastery per outcome, with the evidence behind it (newest first)." />
      {!d ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <ScaleLegend scale={d.scale} />
          <OutcomeProgressList outcomes={d.outcomes} scale={d.scale} />
        </>
      )}
    </div>
  );
}
