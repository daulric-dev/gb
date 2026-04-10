"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Calendar, GraduationCap, LayoutDashboard, LogOut, Menu, UserRoundSearch, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import type { UserProfile } from "@/lib/use-profile";
import { ModeToggle } from "@/components/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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

function navItemActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

function navLinkClass(active: boolean, touch: boolean) {
  return cn(
    "flex items-center rounded-md text-sm transition-colors",
    touch ? "gap-2 px-3 py-2.5" : "gap-1.5 px-3 py-1.5",
    active
      ? "bg-accent font-medium text-accent-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
  );
}

function HeaderBrand() {
  return (
    <Link
      href="/dashboard"
      className="flex min-w-0 flex-1 items-center gap-2 text-base font-bold tracking-tight sm:flex-none sm:text-lg"
    >
      <Image
        src="/icons/logo2.png"
        alt=""
        width={24}
        height={24}
        className="size-6 shrink-0 sm:size-6"
      />
      <span className="truncate">GradeBook</span>
    </Link>
  );
}

type NavLinksProps = {
  pathname: string;
  touchTargets: boolean;
  onNavigate?: () => void;
};

function NavLinks({ pathname, touchTargets, onNavigate }: NavLinksProps) {
  return (
    <>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = navItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={navLinkClass(isActive, touchTargets)}
            onClick={onNavigate}
          >
            <Icon className={cn("shrink-0", touchTargets ? "size-4" : "size-3.5")} />
            {item.title}
          </Link>
        );
      })}
    </>
  );
}

function MobileNav({ pathname, open, onOpenChange }: { pathname: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 sm:hidden"
            aria-label="Open navigation menu"
          />
        }
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(100vw,20rem)] gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="text-base">Navigation</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-0.5 p-2">
          <NavLinks
            pathname={pathname}
            touchTargets
            onNavigate={() => onOpenChange(false)}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <nav className="hidden min-w-0 shrink sm:flex sm:items-center sm:gap-1">
      <NavLinks pathname={pathname} touchTargets={false} />
    </nav>
  );
}

function UserMenu({
  profile,
  displayName,
  onLogout,
}: {
  profile: UserProfile | null;
  displayName: string;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent"
          />
        }
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-xs">{getInitials(profile)}</AvatarFallback>
        </Avatar>
        <div className="hidden min-w-0 flex-col items-start sm:flex">
          <span className="truncate text-sm font-medium leading-tight">{displayName}</span>
          {profile?.school?.name && (
            <span className="truncate text-xs leading-tight text-muted-foreground">
              {profile.school.name}
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onLogout}>
          <LogOut className="mr-2 size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header({ profile }: { profile: UserProfile | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      toast.error("Failed to logout");
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
      <div className="mx-auto flex h-14 min-h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <MobileNav pathname={pathname} open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
          <HeaderBrand />
          <DesktopNav pathname={pathname} />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <ModeToggle />
          <UserMenu profile={profile} displayName={displayName} onLogout={handleLogout} />
        </div>
      </div>
    </header>
  );
}