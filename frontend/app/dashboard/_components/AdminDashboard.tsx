"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  Cell,
  Pie,
  PieChart,
} from "recharts";
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
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useProfile } from "@/providers/AuthProvider";
import {
  ArrowRight,
  GraduationCap,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { StatCard } from "./StatCard";

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  grading_model: string;
}

interface SchoolMember {
  id: string;
  role: "admin" | "teacher" | "member";
}

interface SchoolStudent {
  id: string;
  gender: "male" | "female" | null;
  is_active: boolean;
}

interface JoinRequest {
  id: string;
}

const STAFF_CONFIG: ChartConfig = {
  admin: { label: "Admins", color: "var(--color-chart-1)" },
  teacher: { label: "Teachers", color: "var(--color-chart-2)" },
  member: { label: "Members", color: "var(--color-chart-3)" },
};

const STUDENT_CONFIG: ChartConfig = {
  male: { label: "Male", color: "var(--color-chart-2)" },
  female: { label: "Female", color: "var(--color-chart-4)" },
};

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

function CompositionCard({
  title,
  description,
  config,
  data,
  emptyMessage,
}: {
  title: string;
  description: string;
  config: ChartConfig;
  data: { key: string; name: string; value: number }[];
  emptyMessage: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <ChartContainer config={config} className="mx-auto aspect-square h-64">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                strokeWidth={2}
                label={({ value }) => value}
                labelLine={false}
                className="text-xs font-medium [&_.recharts-pie-label-text]:fill-foreground"
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={`var(--color-${d.key})`} />
                ))}
              </Pie>
              <ChartLegend
                content={<ChartLegendContent nameKey="name" />}
                verticalAlign="bottom"
              />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminDashboard() {
  useSignals();
  const { profile } = useProfile();

  const activeYear = useSignal<AcademicYear | null>(null);
  const members = useSignal<SchoolMember[]>([]);
  const students = useSignal<SchoolStudent[]>([]);
  const pendingRequests = useSignal<JoinRequest[]>([]);
  const loading = useSignal(true);

  useEffect(() => {
    Promise.all([
      api<AcademicYear | null>("/academic-years/active").catch(() => null),
      api<SchoolMember[]>("/schools/members").catch(() => []),
      api<SchoolStudent[]>("/students").catch(() => []),
      api<JoinRequest[]>("/schools/join-requests").catch(() => []),
    ])
      .then(([year, mems, studs, reqs]) => {
        activeYear.value = year;
        members.value = mems;
        students.value = studs;
        pendingRequests.value = reqs;
      })
      .finally(() => (loading.value = false));
  }, []);

  const schoolName = profile.value?.school?.name ?? "your school";

  const staffData = (() => {
    const counts: Record<"admin" | "teacher" | "member", number> = {
      admin: 0,
      teacher: 0,
      member: 0,
    };
    for (const m of members.value) counts[m.role] += 1;
    return (Object.keys(counts) as Array<keyof typeof counts>)
      .filter((k) => counts[k] > 0)
      .map((k) => ({
        key: k,
        name: STAFF_CONFIG[k].label as string,
        value: counts[k],
      }));
  })();

  const studentData = (() => {
    const counts = { male: 0, female: 0 };
    for (const s of students.value) {
      if (!s.is_active) continue;
      // Only tally known genders; null/unset (or any unexpected value) would
      // otherwise add a stray key that has no STUDENT_CONFIG entry.
      if (s.gender === "male" || s.gender === "female") counts[s.gender] += 1;
    }
    return (Object.keys(counts) as Array<keyof typeof counts>)
      .filter((k) => counts[k] > 0)
      .map((k) => ({
        key: k,
        name: STUDENT_CONFIG[k].label as string,
        value: counts[k],
      }));
  })();

  const activeStudentCount = students.value.filter((s) => s.is_active).length;
  const pendingCount = pendingRequests.value.length;

  return (
    <div className="space-y-8">
      <p className="animate-fade-in-up text-muted-foreground">
        Here&apos;s an overview of {schoolName}.
      </p>

      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={GraduationCap}
          value={activeYear.value ? activeYear.value.name : "-"}
          label="Active Year"
          loading={loading.value}
        />
        <StatCard
          icon={Users}
          value={activeStudentCount}
          label="Students"
          loading={loading.value}
        />
        <StatCard
          icon={UsersRound}
          value={members.value.length}
          label="Staff"
          loading={loading.value}
        />
        <StatCard
          icon={UserPlus}
          value={pendingCount}
          label="Pending Requests"
          loading={loading.value}
        />
      </div>

      {pendingCount > 0 && (
        <Card className="animate-fade-in-up-delay-2 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <UserPlus className="size-5 text-primary" />
              <div>
                <p className="font-medium">
                  {pendingCount} pending join{" "}
                  {pendingCount === 1 ? "request" : "requests"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Review and approve to add new members to your school.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              render={
                <Link href="/dashboard/staff">
                  Review
                  <ArrowRight className="ml-1.5 size-3.5" />
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}

      <div className="grid animate-fade-in-up-delay-2 gap-4 md:grid-cols-2">
        <CompositionCard
          title="Staff Composition"
          description="Members of your school by role"
          config={STAFF_CONFIG}
          data={staffData}
          emptyMessage="No staff members yet."
        />
        <CompositionCard
          title="Student Distribution"
          description="Active students by gender"
          config={STUDENT_CONFIG}
          data={studentData}
          emptyMessage="No active students yet."
        />
      </div>

      {activeYear.value && <CurrentAcademicYearCard year={activeYear.value} />}
    </div>
  );
}
