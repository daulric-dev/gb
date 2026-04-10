"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/use-profile";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Users } from "lucide-react";

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: string;
}

interface ClassItem {
  id: string;
  name: string;
}

function DashboardGreeting({ profileLoading, displayName }: { profileLoading: boolean; displayName: string }) {
  return (
    <div className="animate-fade-in-up">
      {profileLoading ? (
        <Skeleton className="h-9 w-48" />
      ) : (
        <h1 className="text-3xl font-bold">hello {displayName}</h1>
      )}
      <p className="mt-1 text-muted-foreground">
        here&apos;s an overview of your school
      </p>
    </div>
  );
}

function OverviewStatCards({
  loading,
  activeYear,
  classCount,
}: {
  loading: boolean;
  activeYear: AcademicYear | null;
  classCount: number;
}) {
  return (
    <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <GraduationCap className="size-5 text-primary" />
            <div>
              {loading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <p className="text-2xl font-bold">
                  {activeYear ? activeYear.name : "-"}
                </p>
              )}
              <p className="text-sm text-muted-foreground">Active Year</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Users className="size-5 text-primary" />
            <div>
              {loading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-2xl font-bold">{classCount}</p>
              )}
              <p className="text-sm text-muted-foreground">Classes</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentAcademicYearCard({ year }: { year: AcademicYear }) {
  return (
    <Card className="animate-fade-in-up-delay-2">
      <CardHeader>
        <CardTitle>Current Academic Year</CardTitle>
        <CardDescription>{year.name}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {new Date(year.start_date).toLocaleDateString()} -{" "}
            {new Date(year.end_date).toLocaleDateString()}
          </span>
          <Badge variant="secondary" className="capitalize">
            {year.grading_model.replace("_", " ")}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  useSignals();
  const { profile, loading: profileLoading } = useProfile();
  const activeYear = useSignal<AcademicYear | null>(null);
  const classes = useSignal<ClassItem[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    Promise.all([
      api<AcademicYear | null>("/academic-years/active").catch(() => null),
      api<ClassItem[]>("/classes").catch(() => []),
    ]).then(([year, cls]) => {
      activeYear.value = year;
      classes.value = cls;
      loading.value = false;
    });
  }, []);

  const displayName = profile?.first_name
    ? profile.first_name.toLowerCase()
    : "there";

  return (
    <div className="space-y-8">
      <DashboardGreeting profileLoading={profileLoading} displayName={displayName} />

      <OverviewStatCards
        loading={loading.value}
        activeYear={activeYear.value}
        classCount={classes.value.length}
      />

      {activeYear.value && <CurrentAcademicYearCard year={activeYear.value} />}
    </div>
  );
}
