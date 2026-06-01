"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarRange,
  ChevronsUpDown,
  FileText,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Scale,
  Settings,
  Shield,
  UserRoundSearch,
  Users,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { UserProfile } from "@/providers/AuthProvider";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Academic Calendar", href: "/dashboard/academic-calendar", icon: CalendarRange },
  { title: "Classes", href: "/dashboard/classes", icon: Users },
  { title: "Students", href: "/dashboard/students", icon: UserRoundSearch },
  { title: "Staff", href: "/dashboard/staff", icon: UsersRound },
  { title: "Subjects", href: "/dashboard/subjects", icon: BookOpen },
];

const adminNavItems = [
  { title: "Grade Scales", href: "/dashboard/grade-scales", icon: Scale },
  { title: "Roles", href: "/dashboard/roles", icon: KeyRound },
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
                const isActive = navItemActive(pathname ?? "", item.href);
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

        {profile?.role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = navItemActive(pathname ?? "", item.href);
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
        )}

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
              {profile?.avatar_url && (
                <AvatarImage src={profile.avatar_url} alt="Profile picture" />
              )}
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
