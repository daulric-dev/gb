"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { isStudentProfile, loginPath, SCAN_PATH } from "@/lib/routing";
import { api } from "@/lib/api";
import { resetBillingState } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { AttendanceBanner } from "./_components/attendance-banner";
import { BillingBanner, BillingStatusLoader } from "@/components/billing/billing-banner";
import { NotificationBell } from "./_components/notification-bell";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/courses", label: "Courses", icon: BookOpen },
  { href: "/portal/grades", label: "Grades", icon: GraduationCap },
  { href: "/portal/work", label: "To-do", icon: CheckSquare },
  { href: "/portal/calendar", label: "Calendar", icon: CalendarDays },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();

  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { profile, loading } = useProfile();
  const isScan = pathname === SCAN_PATH;

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      // Come back to this exact page (a scanned QR link) after signing in.
      router.replace(
        loginPath(`${window.location.pathname}${window.location.search}`),
      );
      return;
    }
    // Staff belong in /dashboard, except on the scan page, which tells them
    // only students check in. A student with no school has not redeemed a
    // school join code yet, so there is nothing to show them here.
    if (!isStudentProfile(profile.value)) {
      if (isScan) return;
      router.replace("/dashboard");
      return;
    }
    if (!profile.value.school) {
      router.replace("/schools");
    }
  }, [loading.value, profile.value, router, isScan]);

  if (!loading.value && isScan && profile.value && !isStudentProfile(profile.value)) {
    return (
      <div className="min-h-dvh bg-background">
        <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
      </div>
    );
  }

  // Bound once so the rest of the render has a non-null profile to work with.
  const student = profile.value;
  if (loading.value || !isStudentProfile(student) || !student?.school) {
    return null;
  }

  const name =
    [student.first_name, student.last_name].filter(Boolean).join(" ") ||
    "Student";
  const initials =
    [student.first_name?.[0], student.last_name?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || "?";

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      toast.error("Failed to log out");
    }
    resetBillingState();
    router.push("/login");
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-2 overflow-hidden">
            <Image
              src="/icons/logo2.png"
              alt=""
              width={24}
              height={24}
              className="size-6 shrink-0"
            />
            <span className="truncate text-sm font-semibold">
              {student.school.name}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ModeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Account" />
                }
              >
                <Avatar className="size-7">
                  <AvatarImage src="/api/auth/avatar" alt="" />
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>{name}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/portal/settings")}>
                  <Settings className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <nav className="mx-auto max-w-5xl px-2">
          <div className="flex gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <BillingStatusLoader schoolId={student.school.id} />
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <BillingBanner audience="student" />
        {/* The scan page is itself the check-in for that session. */}
        {!isScan && <AttendanceBanner />}
        {children}
      </main>
    </div>
  );
}
