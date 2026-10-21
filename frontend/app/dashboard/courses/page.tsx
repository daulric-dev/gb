"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { BookOpen, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { Course, CourseStatus } from "@/lib/courses/types";
import {
  calendarLabel,
  loadCalendar,
  termName,
  type TermOption,
  type YearOption,
} from "@/lib/courses/calendar";
import { usePermissions } from "@/providers/PermissionsProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CourseCard, CourseCardSkeleton } from "./_components/CourseCard";
import { CreateCourseDialog } from "./_components/CreateCourseDialog";

type StatusFilter = "all" | CourseStatus;
const ALL_TERMS = "all";

export default function CoursesPage() {
  useSignals();
  const { can } = usePermissions();

  const courses = useSignal<Course[]>([]);
  const loading = useSignal(true);
  const status = useSignal<StatusFilter>("all");
  const termId = useSignal(ALL_TERMS);
  const search = useSignal("");
  const years = useSignal<YearOption[]>([]);
  const terms = useSignal<TermOption[]>([]);

  useEffect(() => {
    void loadCalendar().then((cal) => {
      years.value = cal.years;
      terms.value = cal.terms;
    });
  }, [years, terms]);

  const statusValue = status.value;
  const termValue = termId.value;
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusValue !== "all") params.set("status", statusValue);
    if (termValue !== ALL_TERMS) params.set("termId", termValue);
    const qs = params.toString();

    loading.value = true;
    api<Course[]>(`/courses${qs ? `?${qs}` : ""}`)
      .then((data) => (courses.value = data))
      .catch(() => {
        courses.value = [];
        toast.error("Failed to load courses");
      })
      .finally(() => (loading.value = false));
  }, [statusValue, termValue, courses, loading]);

  const query = search.value.trim().toLowerCase();
  const visible = query
    ? courses.value.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.code ?? "").toLowerCase().includes(query),
      )
    : courses.value;

  const termItems = [
    { value: ALL_TERMS, label: "All terms" },
    ...terms.value.map((t) => {
      const year = years.value.find((y) => y.id === t.academic_year_id);
      return {
        value: t.id,
        label: year ? `${year.name} · ${termName(t.name)}` : termName(t.name),
      };
    }),
  ];

  const canCreate = can("course", "create");
  const filtered = statusValue !== "all" || termValue !== ALL_TERMS || !!query;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Courses"
        description="Everything you teach, in one place"
        action={
          canCreate ? (
            <CreateCourseDialog years={years.value} terms={terms.value} />
          ) : undefined
        }
      />

      <div className="flex animate-fade-in-up-delay-1 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs
          value={statusValue}
          onValueChange={(v) => (status.value = v as StatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search courses"
              className="pl-8 sm:w-56"
              value={search.value}
              onChange={(e) => (search.value = e.target.value)}
            />
          </div>
          {terms.value.length > 0 && (
            <Select
              value={termValue}
              onValueChange={(v) => (termId.value = v as string)}
              items={termItems}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {termItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {loading.value ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Empty className="animate-fade-in-up-delay-2 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>
              {filtered ? "No courses match" : "No courses yet"}
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another status, term or search."
                : canCreate
                  ? "Create your first course to start adding modules, pages and work."
                  : "Courses you teach or assist in will appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid animate-fade-in-up-delay-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              termLabel={calendarLabel(course, years.value, terms.value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
