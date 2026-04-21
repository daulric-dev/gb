"use client";

import { useEffect } from "react";
import { useSignal, useComputed } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  BookOpen,
  Calendar,
  Check,
  ChevronsUpDown,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Search,
  Settings,
  Shield,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import type { UserProfile } from "@/lib/use-profile";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface School {
  id: string;
  name: string;
  parish: string | null;
  school_type: string | null;
}

function ChangeSchoolDialog({
  currentSchoolId,
  children,
}: {
  currentSchoolId?: string;
  children: React.ReactNode;
}) {
  useSignals();
  const router = useRouter();
  const open = useSignal(false);
  const schools = useSignal<School[]>([]);
  const loading = useSignal(false);
  const saving = useSignal<string | null>(null);
  const search = useSignal("");

  const filtered = useComputed(() => {
    const q = search.value.toLowerCase();
    if (!q) return schools.value;
    return schools.value.filter(
      (s) => s.name.toLowerCase().includes(q) || s.parish?.toLowerCase().includes(q),
    );
  });

  useEffect(() => {
    if (!open.value) {
      search.value = "";
      return;
    }
    loading.value = true;
    api<School[]>("/schools")
      .then((data) => (schools.value = data))
      .catch(() => toast.error("Failed to load schools"))
      .finally(() => (loading.value = false));
  }, [open.value]);

  async function handleSelect(school: School) {
    if (school.id === currentSchoolId) return;
    saving.value = school.id;
    try {
      await api("/auth/profile", {
        method: "PATCH",
        body: { schoolId: school.id },
      });
      toast.success(`Switched to ${school.name}`);
      open.value = false;
      router.refresh();
      window.location.reload();
    } catch {
      toast.error("Failed to switch school");
    } finally {
      saving.value = null;
    }
  }

  return (
    <Dialog open={open.value} onOpenChange={(v) => (open.value = v)}>
      <DialogTrigger render={<span />}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change School</DialogTitle>
          <DialogDescription>Select a school to switch to.</DialogDescription>
        </DialogHeader>
        {!loading.value && schools.value.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search schools..."
              value={search.value}
              onChange={(e) => (search.value = e.target.value)}
              className="w-full rounded-md border border-input bg-transparent py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto -mx-1">
          {loading.value ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.value.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {schools.value.length === 0 ? "No schools found." : "No matching schools."}
            </p>
          ) : (
            <div className="space-y-0.5 px-1">
              {filtered.value.map((school) => {
                const isActive = school.id === currentSchoolId;
                const isSaving = saving.value === school.id;
                return (
                  <button
                    key={school.id}
                    type="button"
                    disabled={isSaving || isActive}
                    onClick={() => handleSelect(school)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    } disabled:opacity-70`}
                  >
                    <GraduationCap className="size-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{school.name}</p>
                      {school.parish && (
                        <p className="text-xs text-muted-foreground truncate">
                          {school.parish}
                        </p>
                      )}
                    </div>
                    {isSaving && <Loader2 className="size-4 animate-spin shrink-0" />}
                    {isActive && !isSaving && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

export function AppSidebar({ profile }: { profile: UserProfile | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

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
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden">
          <Image
            src="/icons/logo2.png"
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0"
          />
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-lg font-bold tracking-tight truncate block">GradeBook</span>
              <span className="text-[10px] text-muted-foreground/60 -mt-1 block">
                by daulric.dev
              </span>
            </div>
          )}
        </Link>
        {!collapsed && profile?.school?.name && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground truncate flex-1">
              {profile.school.name}
            </span>
            <ChangeSchoolDialog currentSchoolId={profile.school.id}>
              <button
                type="button"
                title="Change school"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
              >
                <ArrowLeftRight className="size-3" />
              </button>
            </ChangeSchoolDialog>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = navItemActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Icon className="size-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Legal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/terms" target="_blank" />}
                  tooltip="Terms of Service"
                >
                  <FileText className="size-4" />
                  <span>Terms of Service</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/privacy" target="_blank" />}
                  tooltip="Privacy Policy"
                >
                  <Shield className="size-4" />
                  <span>Privacy Policy</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent transition-colors overflow-hidden" />
            }
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="text-xs">
                {getInitials(profile)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-medium truncate text-sm leading-tight">{displayName}</p>
                  {profile?.role && (
                    <p className="text-xs text-muted-foreground capitalize leading-tight">
                      {profile.role}
                    </p>
                  )}
                </div>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={collapsed ? "center" : "start"}
            side={collapsed ? "right" : "top"}
            className="w-56"
          >
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{displayName}</p>
              {profile?.email && (
                <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              )}
            </div>
            <DropdownMenuItem onClick={() => router.push("/dashboard/settings")}>
              <Settings className="mr-2 size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
