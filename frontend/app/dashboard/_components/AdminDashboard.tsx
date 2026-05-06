"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Users } from "lucide-react";
import { StatCard } from "./StatCard";

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: string;
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

export function AdminDashboard({ classCount }: { classCount: number }) {
  useSignals();
  const activeYear = useSignal<AcademicYear | null>(null);
  const loading = useSignal(true);

  useEffect(() => {
    api<AcademicYear | null>("/academic-years/active")
      .then((year) => (activeYear.value = year))
      .catch(() => (activeYear.value = null))
      .finally(() => (loading.value = false));
  }, []);

  return (
    <div className="space-y-8">
      <p className="animate-fade-in-up text-muted-foreground">
        Here&apos;s an overview of your school
      </p>

      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={GraduationCap}
          value={activeYear.value ? activeYear.value.name : "-"}
          label="Active Year"
          loading={loading.value}
        />
        <StatCard icon={Users} value={classCount} label="Your Classes" />
      </div>

      {activeYear.value && <CurrentAcademicYearCard year={activeYear.value} />}
    </div>
  );
}
