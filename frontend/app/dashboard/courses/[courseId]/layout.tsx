"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  FileText,
  House,
  Layers,
  Megaphone,
  SearchX,
  Settings,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Course } from "@/lib/courses/types";
import {
  canManageCourse,
  COURSE_ROLE_LABEL,
  courseGradient,
} from "@/lib/courses/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CourseStatusBadge } from "../_components/CourseStatusBadge";
import { CourseContext } from "./_components/course-context";

export default function CourseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();
  const params = useParams<{ courseId: string }>();
  const courseId = params?.courseId ?? "";
  const pathname = usePathname() ?? "";

  const course = useSignal<Course | null>(null);
  const loading = useSignal(true);
  const missing = useSignal(false);

  const reload = useCallback(async () => {
    if (!courseId) return;
    try {
      course.value = await api<Course>(`/courses/${courseId}`);
      missing.value = false;
    } catch (err) {
      // The API answers 404 for courses the caller has no role in.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        missing.value = true;
      }
      course.value = null;
    } finally {
      loading.value = false;
    }
  }, [courseId, course, loading, missing]);

  useEffect(() => {
    loading.value = true;
    void reload();
  }, [reload, loading]);

  if (loading.value) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex gap-8">
          <div className="hidden w-48 space-y-2 md:block">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <div className="flex-1 space-y-3">
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!course.value) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>
            {missing.value ? "Course not found" : "Could not load the course"}
          </EmptyTitle>
          <EmptyDescription>
            {missing.value
              ? "It may have been deleted, or you are not part of it."
              : "Check your connection and try again."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard/courses" />}
          >
            <ArrowLeft className="mr-2 size-4" />
            All courses
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const c = course.value;
  const base = `/dashboard/courses/${c.id}`;
  const canManage = canManageCourse(c.role);

  const items = [
    { href: base, label: "Home", icon: House, exact: true },
    { href: `${base}/modules`, label: "Modules", icon: Layers },
    { href: `${base}/assignments`, label: "Assignments", icon: ClipboardList },
    { href: `${base}/pages`, label: "Pages", icon: FileText },
    { href: `${base}/announcements`, label: "Announcements", icon: Megaphone },
    { href: `${base}/people`, label: "People", icon: Users },
    { href: `${base}/attendance`, label: "Attendance", icon: CalendarCheck },
    { href: `${base}/grades`, label: "Grades", icon: BarChart3 },
    ...(canManage
      ? [{ href: `${base}/settings`, label: "Settings", icon: Settings }]
      : []),
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <CourseContext.Provider
      value={{ course: c, base, canManage, reload }}
    >
      <div className="space-y-6">
        <header
          className="relative animate-fade-in-up overflow-hidden rounded-xl px-5 py-5 text-white shadow-sm"
          style={{ background: courseGradient(c.id) }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.22),transparent_50%)]" />
          <div className="relative flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Link
                href="/dashboard/courses"
                className="inline-flex items-center gap-1 text-xs font-medium text-white/80 hover:text-white"
              >
                <ArrowLeft className="size-3.5" />
                Courses
              </Link>
              <h1 className="truncate text-2xl font-bold md:text-3xl">
                {c.name}
              </h1>
              {c.code && (
                <p className="font-mono text-sm text-white/85">{c.code}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge className="border-transparent bg-white/20 text-white">
                {COURSE_ROLE_LABEL[c.role]}
              </Badge>
              <CourseStatusBadge
                status={c.status}
                className="bg-white/90 dark:bg-background/90"
              />
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <nav
            aria-label="Course"
            className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 no-scrollbar md:sticky md:top-4 md:mx-0 md:w-48 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:px-0 md:pb-0"
          >
            {items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-secondary font-medium text-foreground md:border-l-2 md:border-primary md:rounded-l-none"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </CourseContext.Provider>
  );
}
