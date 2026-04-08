"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GraduationCap, Users, LayoutDashboard, LogOut, UserRoundSearch, BookOpen, Calendar } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import type { UserProfile } from "@/lib/use-profile";
import { ModeToggle } from "@/components/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Academic Years", href: "/dashboard/academic-years", icon: GraduationCap },
  { title: "Classes", href: "/dashboard/classes", icon: Users },
  { title: "Students", href: "/dashboard/students", icon: UserRoundSearch },
  { title: "Subjects", href: "/dashboard/subjects", icon: BookOpen },
  { title: "Terms", href: "/dashboard/terms", icon: Calendar },
];

function getInitials(profile: UserProfile | null) {
  if (!profile?.first_name) return "?";
  const first = profile.first_name?.[0] || "";
  const last = profile.last_name?.[0] || "";
  return `${first}${last}`.toUpperCase();
}

export function Header({ profile }: { profile: UserProfile | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // proceed even if api call fails
    }
    clearTokens();
    router.push("/login");
    toast.success("Logged out");
  }

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ""}`.trim()
    : profile?.email || "User";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            GradeBook
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <item.icon className="size-3.5" />
                  {item.title}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex items-center gap-2 rounded-full p-1 hover:bg-accent transition-colors" />
              }
            >
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">
                  {getInitials(profile)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-sm font-medium leading-tight">
                  {displayName}
                </span>
                {profile?.school?.name && (
                  <span className="text-xs text-muted-foreground leading-tight">
                    {profile.school.name}
                  </span>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
