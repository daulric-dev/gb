"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LayoutDashboard,  ClipboardList,  CalendarCheck,  ScrollText,  FileBarChart, UserPlus } from "lucide-react";

interface ClassInfo {
  id: string;
  name: string;
  academicYearId: string;
  isClassTeacher: boolean;
}

export default function ClassLayout({ children }: { children: React.ReactNode}) {
  useSignals();
  const params = useParams();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const classId = params?.classId as string;

  const info = useSignal<ClassInfo | null>(null);

  useEffect(() => {
    api<ClassInfo[]>("/classes")
      .then((list) => {
        info.value = list.find((c) => c.id === classId) ?? null;
      })
      .catch(() => {
        info.value = null;
      });
  }, [classId]);

  const base = `/dashboard/classes/${classId}`;
  const isTeacher = info.value?.isClassTeacher ?? false;

  const items = [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true, show: true },
    { href: `${base}/grading`, label: "Grading", icon: ClipboardList, show: true },
    { href: `${base}/attendance`, label: "Attendance", icon: CalendarCheck, show: true },
    { href: `${base}/reports`, label: "Reports", icon: ScrollText, show: isTeacher },
    { href: `${base}/class-report`, label: "Class Report", icon: FileBarChart, show: isTeacher },
  ].filter((i) => i.show);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <nav className="flex flex-col gap-4 md:w-52 md:shrink-0">
        {/* Mobile Header: Back button + Class Name */}
        <div className="flex items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboard/classes")}
            className="size-9 shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Button>
          {info.value && (
            <div className="truncate text-lg font-bold">
              {info.value.name}
            </div>
          )}
        </div>

        {/* Desktop Header: Back button + Class Name */}
        <div className="hidden space-y-1 md:block">
          <Button
            variant="ghost"
            size="sm"
            className="mb-1 w-full justify-start text-muted-foreground"
            onClick={() => router.push("/dashboard/classes")}
          >
            <ArrowLeft className="mr-2 size-4" />
            All Classes
          </Button>
          {info.value && (
            <div className="truncate px-3 pb-1 text-sm font-semibold">
              {info.value.name}
            </div>
          )}
        </div>

        {/* Navigation items (horizontal scroll on mobile, vertical stack on desktop) */}
        <div className="flex gap-1 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 md:flex-col md:gap-1 md:pb-0 md:overflow-visible">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Button
                key={item.href}
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="shrink-0 justify-start md:w-full"
                onClick={() => router.push(item.href)}
              >
                <Icon className="mr-2 size-4" />
                {item.label}
              </Button>
            );
          })}
          {isTeacher && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 justify-start md:w-full"
              onClick={() => router.push(`${base}?enroll=1`)}
            >
              <UserPlus className="mr-2 size-4" />
              Enroll Students
            </Button>
          )}
        </div>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
