"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Cell, Pie, PieChart } from "recharts";
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
  BookOpen,
  ClipboardList,
  GraduationCap,
  Megaphone,
  PlusCircle,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { formatDate } from "@/lib/courses/format";
import { StatCard } from "./StatCard";
import type {
  DashboardSummary,
  RecentActivityEntry,
  SchoolOverview,
} from "./types";

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

const COURSE_CONFIG: ChartConfig = {
  published: { label: "Published", color: "var(--color-chart-2)" },
  draft: { label: "Draft", color: "var(--color-chart-4)" },
  archived: { label: "Archived", color: "var(--color-chart-3)" },
};

const ACTIVITY_META: Record<
  RecentActivityEntry["type"],
  { icon: LucideIcon; verb: string }
> = {
  course_created: { icon: PlusCircle, verb: "Course created" },
  activity_published: { icon: ClipboardList, verb: "Work published" },
  announcement: { icon: Megaphone, verb: "Announcement" },
};

function toChart<K extends string>(
  counts: Record<K, number>,
  config: ChartConfig,
) {
  return (Object.keys(counts) as K[])
    .filter((k) => counts[k] > 0)
    .map((k) => ({
      key: k,
      name: config[k]?.label as string,
      value: counts[k],
    }));
}

function RecentActivityCard({ items }: { items: RecentActivityEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Across every course in the school</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          items.map((item) => {
            const meta = ACTIVITY_META[item.type];
            const Icon = meta?.icon ?? BookOpen;
            const href = item.courseId
              ? item.type === "activity_published"
                ? `/dashboard/courses/${item.courseId}/assignments/${item.id}`
                : item.type === "announcement"
                  ? `/dashboard/courses/${item.courseId}/announcements`
                  : `/dashboard/courses/${item.courseId}`
              : "/dashboard/announcements";
            return (
              <Link
                key={`${item.type}-${item.id}`}
                href={href}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {meta?.verb ?? "Update"}
                    {item.courseName && item.type !== "course_created"
                      ? ` · ${item.courseName}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(item.at)}
                </span>
              </Link>
            );
          })
        )}
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

export function AdminDashboard({
  school,
  activeYear,
}: {
  school: SchoolOverview | null;
  activeYear: DashboardSummary["activeYear"];
}) {
  useSignals();
  const { profile } = useProfile();

  const students = useSignal<SchoolStudent[]>([]);
  const pendingRequests = useSignal<JoinRequest[]>([]);
  const loading = useSignal(true);

  // Gender split and join requests are not in the summary; the counts are.
  useEffect(() => {
    Promise.all([
      api<SchoolStudent[]>("/students").catch(() => []),
      api<JoinRequest[]>("/schools/join-requests").catch(() => []),
    ])
      .then(([studs, reqs]) => {
        students.value = studs;
        pendingRequests.value = reqs;
      })
      .finally(() => (loading.value = false));
  }, [loading, pendingRequests, students]);

  const schoolName = profile.value?.school?.name ?? "your school";

  const studentCounts = { male: 0, female: 0 };
  for (const s of students.value) {
    if (!s.is_active) continue;
    if (s.gender === "male" || s.gender === "female") studentCounts[s.gender] += 1;
  }

  const staffData = school
    ? toChart(
        {
          admin: school.staff.admins,
          teacher: school.staff.teachers,
          member: school.staff.members,
        },
        STAFF_CONFIG,
      )
    : [];
  const courseData = school
    ? toChart(
        {
          published: school.courses.published,
          draft: school.courses.draft,
          archived: school.courses.archived,
        },
        COURSE_CONFIG,
      )
    : [];
  const studentData = toChart(studentCounts, STUDENT_CONFIG);

  const activeStudentCount =
    school?.students.active ?? students.value.filter((s) => s.is_active).length;
  const pendingCount = pendingRequests.value.length;

  return (
    <div className="space-y-8">
      <p className="animate-fade-in-up text-muted-foreground">
        Here&apos;s an overview of {schoolName}.
      </p>

      <div className="grid animate-fade-in-up-delay-1 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={GraduationCap}
          value={activeYear ? activeYear.name : "-"}
          label="Active Year"
        />
        <StatCard
          icon={BookOpen}
          value={school?.courses.published ?? "-"}
          label="Published Courses"
        />
        <StatCard
          icon={Users}
          value={activeStudentCount}
          label="Active Students"
          loading={!school && loading.value}
        />
        <StatCard
          icon={UsersRound}
          value={school?.staff.total ?? "-"}
          label="Staff"
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
              nativeButton={false}
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

      <div className="grid animate-fade-in-up-delay-2 gap-4 lg:grid-cols-3">
        <CompositionCard
          title="Courses"
          description="Every course by status"
          config={COURSE_CONFIG}
          data={courseData}
          emptyMessage="No courses yet."
        />
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

      {school && <RecentActivityCard items={school.recentActivity} />}

      {activeYear && (
        <Card className="animate-fade-in-up-delay-3">
          <CardHeader>
            <CardTitle>Current Academic Year</CardTitle>
            <CardDescription>{activeYear.name}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatDate(activeYear.startDate)} - {formatDate(activeYear.endDate)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
