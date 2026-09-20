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

  const { student, classes, subjects, account, guardians } = profile.value;
  const name = `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim();
  const current = classes.filter((c) => c.academicYear?.isActive);
  const past = classes.filter((c) => !c.academicYear?.isActive);

  return (
    <div className="space-y-6">
      <BackTitleToolbar
        title={name || "Student"}
        description={
          current.length > 0
            ? current.map((c) => c.name).join(", ")
            : "Not in a class this year"
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Classes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {classes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Not enrolled in any class yet.
            </p>
          ) : (
            <>
              {current.map((c) => (
                <Link key={c.id} href={`/dashboard/classes/${c.id}`}>
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.academicYear?.name ?? "No academic year"}
                      </p>
                    </div>
                    <Badge variant="secondary">This year</Badge>
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
                    <Link key={c.id} href={`/dashboard/classes/${c.id}`}>
                      <div className="flex items-center gap-3 rounded-md border px-3 py-2 opacity-70 transition-colors hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {c.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.academicYear?.name ?? "No academic year"}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subjects this year</CardTitle>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No subjects recorded for this year.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => (
                <Badge key={s.id} variant="outline">
                  {s.name}
                  {s.code ? ` (${s.code})` : ""}
                  {!s.isGraded && " · not graded"}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {guardians.length > 0 && (
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
    </div>
  );
}
