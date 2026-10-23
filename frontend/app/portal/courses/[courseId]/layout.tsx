"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ArrowLeft, BookX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  courseAccent,
  teacherNames,
  type PortalCourseDetail,
} from "../../_components/types";
import { EmptyState } from "../../_components/portal-ui";
import { CourseProvider } from "./_components/course-context";

const TABS = [
  { slug: "", label: "Home" },
  { slug: "modules", label: "Modules" },
  { slug: "assignments", label: "Assignments" },
  { slug: "grades", label: "Grades" },
  { slug: "attendance", label: "Attendance" },
  { slug: "announcements", label: "Announcements" },
  { slug: "discussions", label: "Discussions" },
];

export default function PortalCourseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();

  const params = useParams<{ courseId: string }>();
  const courseId = params?.courseId ?? "";
  const pathname = usePathname() ?? "";

  const course = useSignal<PortalCourseDetail | null>(null);
  const loading = useSignal(true);
  const missing = useSignal(false);

  useEffect(() => {
    if (!courseId) return;
    loading.value = true;
    missing.value = false;
    api<PortalCourseDetail>(`/portal/me/courses/${courseId}`)
      .then((data) => (course.value = data))
      .catch((err) => {
        course.value = null;
        missing.value = !(err instanceof ApiError && err.status === 0);
      })
      .finally(() => (loading.value = false));
  }, [courseId, course, loading, missing]);

  if (loading.value) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex gap-2">
          {TABS.map((t) => (
            <Skeleton key={t.slug} className="h-8 w-24" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!course.value) {
    return (
      <EmptyState
        icon={BookX}
        title={missing.value ? "Course not found" : "Could not load this course"}
        description={
          missing.value
            ? "It may have been removed, or you are no longer enrolled."
            : "Check your connection and try again."
        }
      >
        <Link
          href="/portal/courses"
          className={buttonVariants({ variant: "outline" })}
        >
          <ArrowLeft className="mr-2 size-4" />
          Back to courses
        </Link>
      </EmptyState>
    );
  }

  const c = course.value;
  const base = `/portal/courses/${c.id}`;
  const teachers = teacherNames(c.teachers);
  const isActive = (slug: string) => {
    if (!slug) return pathname === base;
    const href = `${base}/${slug}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <CourseProvider value={c}>
      <div className="space-y-6">
        <div
          className={cn(
            "relative overflow-hidden rounded-xl bg-gradient-to-br p-5 text-white shadow-sm",
            courseAccent(c.id),
            c.status === "archived" && "grayscale",
          )}
        >
          <Link
            href="/portal/courses"
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-white/80 hover:text-white"
          >
            <ArrowLeft className="size-3" />
            Courses
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {c.code && (
              <span className="rounded-md bg-black/20 px-2 py-0.5 text-xs font-medium">
                {c.code}
              </span>
            )}
            {c.status === "archived" && (
              <Badge variant="secondary">Archived</Badge>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{c.name}</h1>
          {teachers && <p className="mt-1 text-sm text-white/85">{teachers}</p>}
        </div>

        <nav className="-mx-1 overflow-x-auto border-b">
          <div className="flex gap-1 px-1">
            {TABS.map((t) => {
              const active = isActive(t.slug);
              return (
                <Link
                  key={t.slug}
                  href={t.slug ? `${base}/${t.slug}` : base}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {children}
      </div>
    </CourseProvider>
  );
}
