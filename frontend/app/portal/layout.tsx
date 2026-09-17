"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { isStudentProfile } from "@/lib/routing";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/layout/mode-toggle";
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
  CalendarCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  ScrollText,
} from "lucide-react";

const NAV = [
  { href: "/portal", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/portal/work", label: "Work", icon: FileText },
  { href: "/portal/grades", label: "Grades", icon: ClipboardList },
  { href: "/portal/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/portal/reports", label: "Reports", icon: ScrollText },
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

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      router.replace("/login");
      return;
    }
    // Staff belong in /dashboard; a student with no school has not redeemed a
    // claim code yet, so there is nothing to show them here.
    if (!isStudentProfile(profile.value)) {
      router.replace("/dashboard");
      return;
    }
    if (!profile.value.school) {
      router.replace("/schools");
    }
  }, [loading.value, profile.value, router]);

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

      <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
