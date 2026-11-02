"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { homePathFor, isStudentProfile, loginPath, SCAN_PATH } from "@/lib/routing";
import { useSetupGate } from "@/lib/setup";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { AttendanceBanner } from "./_components/attendance-banner";
import { NotificationBell } from "./_components/notification-bell";
import { useFeatures } from "@/hooks/use-features";
import { featureForPath, type FeatureKey } from "@/lib/features";
import { FeatureDisabled } from "@/components/feature-disabled";
import { ChatProvider } from "@/providers/ChatProvider";
import { unreadChat } from "@/lib/chat";
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
  MessagesSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

const NAV: {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  feature?: FeatureKey;
}[] = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/courses", label: "Courses", icon: BookOpen },
  { href: "/portal/grades", label: "Grades", icon: GraduationCap },
  { href: "/portal/work", label: "To-do", icon: CheckSquare },
  { href: "/portal/calendar", label: "Calendar", icon: CalendarDays, feature: "calendar" },
  {
    href: "/portal/messages",
    label: "Messages",
    icon: MessagesSquare,
    feature: "student_messaging",
  },
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
  const { hasFeature } = useFeatures();
  const isScan = pathname === SCAN_PATH;
  useSetupGate(!loading.value && !!profile.value && !isScan);

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
      router.replace(homePathFor(profile.value));
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
    router.push("/login");
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const nav = NAV.filter((item) => !item.feature || hasFeature(item.feature));
  // A page whose feature is off (a bookmark, an old link) says so instead.
  const pageFeature = featureForPath(pathname);
  const pageOff = pageFeature !== null && !hasFeature(pageFeature);
  const messagingOn = hasFeature("student_messaging");

  return (
    <div className="min-h-dvh bg-background">
      {/* The chat stream only runs while students may message. */}
      {messagingOn && <ChatProvider />}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/portal" className="flex items-center gap-2 overflow-hidden">
            {student.school.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API/CDN
              <img
                src={student.school.logo_url}
                alt=""
                className="size-6 shrink-0 rounded object-contain"
              />
            ) : (
              <Image
                src="/icons/logo2.png"
                alt=""
                width={24}
                height={24}
                className="size-6 shrink-0"
              />
            )}
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
            {nav.map((item) => {
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
                  {item.href === "/portal/messages" && unreadChat.value > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                      {unreadChat.value}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl p-4 md:p-6">
        {/* The scan page is itself the check-in for that session. */}
        {!isScan && hasFeature("attendance") && <AttendanceBanner />}
        {pageOff ? <FeatureDisabled /> : children}
      </main>
    </div>
  );
}
