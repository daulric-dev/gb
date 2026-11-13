"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BackTitleToolbar } from "@/components/dashboard/back-title-toolbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Mail, UserRound } from "lucide-react";
import type { StudentProfile } from "../_components/types";
import { bannerAccent } from "@/lib/courses/appearance";
import { AccommodationCard } from "../_components/AccommodationCard";
import { ParentLinksCard } from "../_components/ParentLinksCard";
import { PastoralTimelineCard } from "../_components/PastoralTimelineCard";
import { useFeatures } from "@/hooks/use-features";
import { usePermissions } from "@/providers/PermissionsProvider";
import { DataExportCard } from "@/components/data-export/data-export-card";
import { StudentRestrictionsCard } from "../_components/StudentRestrictionsCard";
import { EraseStudentCard } from "../_components/EraseStudentCard";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** A labelled value in the details grid. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}

export default function StudentProfilePage() {
  useSignals();

  const router = useRouter();
  const params = useParams<{ studentId: string }>();
  const studentId = params?.studentId ?? "";

  const parentPortalOn = useFeatures().hasFeature("parent_portal");
  const { can } = usePermissions();
  const profile = useSignal<StudentProfile | null>(null);
  const loading = useSignal(true);

  const load = useCallback(() => {
    if (!studentId) return;
    api<StudentProfile>(`/students/${studentId}/profile`)
      .then((data) => (profile.value = data))
      .catch(() => (profile.value = null))
      .finally(() => (loading.value = false));
  }, [studentId, profile, loading]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading.value) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!profile.value) {
    return (
      <BackTitleToolbar
        title="Student"
        description="This could not be loaded"
        onBack={() => router.push("/dashboard/students")}
      />
    );
  }

  // Null without `student:sensitive` (the API leaves guardian contacts out).
  const { student, courses = [], account } = profile.value;
  const guardians = profile.value.guardians ?? [];
  const name = `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim();
  const current = courses.filter((c) => c.enrollmentStatus === "active");
  const past = courses.filter((c) => c.enrollmentStatus !== "active");

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={name || "Student"}
        description={
          current.length > 0
            ? `${current.length} ${current.length === 1 ? "course" : "courses"}`
            : "Not enrolled in any course"
        }
        onBack={() => router.push("/dashboard/students")}
        actions={
          student.is_active ? (
            <Badge>Active</Badge>
          ) : (
            <Badge variant="secondary">Inactive</Badge>
          )
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Gender">
            <span className="capitalize">{student.gender ?? "—"}</span>
          </Field>
          <Field label="Date of birth">{formatDate(student.date_of_birth)}</Field>
          <Field label="Enrolled">{formatDate(student.enrollment_date)}</Field>
          <Field label="Account">
            {account ? (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5 text-muted-foreground" />
                {account.email ?? "Linked"}
              </span>
            ) : (
              <span className="text-muted-foreground">No account</span>
            )}
          </Field>
        </CardContent>
      </Card>

      <AccommodationCard studentId={student.id} />

      <ParentLinksCard studentId={student.id} />

      <PastoralTimelineCard studentId={student.id} studentName={name} />

      {can("student", "update") && <StudentRestrictionsCard studentId={student.id} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Courses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {courses.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Not enrolled in any course yet.
            </p>
          ) : (
            <>
              {current.map((c) => (
                <Link key={c.id} href={`/dashboard/courses/${c.id}`}>
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50">
                    <span
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ background: bannerAccent(c) }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.code ?? "No code"} · enrolled{" "}
                        {formatDate(c.enrolledAt)}
                      </p>
                    </div>
                    {c.status !== "published" && (
                      <Badge variant="secondary" className="capitalize">
                        {c.status}
                      </Badge>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </Link>
              ))}

              {past.length > 0 && (
                <>
                  <p className="pt-2 text-xs text-muted-foreground">
                    Previously
                  </p>
                  {past.map((c) => (
                    <Link key={c.id} href={`/dashboard/courses/${c.id}`}>
                      <div className="flex items-center gap-3 rounded-md border px-3 py-2 opacity-70 transition-colors hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {c.name}
                          </p>
                          <p className="text-xs capitalize text-muted-foreground">
                            {c.enrollmentStatus}
                          </p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {guardians.length > 0 && !parentPortalOn && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Guardians</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {guardians.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
              >
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{g.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {g.email ?? "No email"}
                  </p>
                </div>
                {g.relationship && (
                  <Badge variant="outline" className="capitalize">
                    {g.relationship}
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {can("student", "export") && (
        <DataExportCard kind="student" studentId={student.id} subjectName={name} />
      )}

      {can("student", "erase") && (
        <EraseStudentCard
          studentId={student.id}
          studentName={name}
          onErasedAction={() => router.replace("/dashboard/students")}
        />
      )}
    </div>
  );
}
