"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import {
  unreadAnnouncements,
  refreshAnnouncementUnread,
} from "@/lib/announcements";
import { unreadFiles, refreshFileUnread } from "@/lib/file-notifications";
import { unreadChat, refreshChatUnread } from "@/lib/chat";
import {
  AtSign,
  ClipboardClock,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Clock,
  Building2,
  ChevronsUpDown,
  FileText,
  FileBadge,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  Scale,
  Settings,
  Shield,
  UserRoundSearch,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ORGANISATION_PATH } from "@/lib/routing";
import type { FeatureKey } from "@/lib/features";
import { useFeatures } from "@/hooks/use-features";
import type { UserProfile } from "@/providers/AuthProvider";
import { usePermissions } from "@/providers/PermissionsProvider";
import { SchoolSwitcher } from "@/components/layout/school-switcher";
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
type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Catalog permission required to see this item, as [resource, action]. */
  permission?: [string, string];
  /** Mirrors a backend AdminGuard rather than a catalog permission. */
  adminOnly?: boolean;
  /** Platform feature that must be on for the school. */
  feature?: FeatureKey;
};

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  // Everyone on staff may teach or assist, so no catalog permission gates the
  // list; the API returns only the courses the caller has a role in.
  { title: "Courses", href: "/dashboard/courses", icon: BookOpen },
  // Due dates across the caller's own courses; no permission, like Courses.
  {
    title: "Calendar",
    href: "/dashboard/calendar",
    icon: CalendarDays,
    feature: "calendar",
  },
  // The caller's own periods; the API returns only courses they staff.
  {
    title: "Timetable",
    href: "/dashboard/timetable",
    icon: Clock,
    feature: "timetable",
  },
  // Reports and alerts; open to staff because form tutors see their own
  // tutees here. The school report inside needs attendance-report:read.
  {
    title: "Attendance",
    href: "/dashboard/attendance",
    icon: CalendarCheck,
    feature: "attendance_alerts",
  },
  {
    title: "Students",
    href: "/dashboard/students",
    icon: UserRoundSearch,
    permission: ["student", "read"],
  },
  {
    title: "Staff",
    href: "/dashboard/staff",
    icon: UsersRound,
    permission: ["school", "read"],
  },
  {
    title: "Academic Calendar",
    href: "/dashboard/academic-calendar",
    icon: CalendarRange,
    permission: ["academic-year", "read"],
  },
  {
    title: "Files",
    href: "/dashboard/files",
    icon: FolderOpen,
    permission: ["file", "read"],
    feature: "files",
  },
  {
    title: "Messages",
    href: "/dashboard/chat",
    icon: MessagesSquare,
    permission: ["chat", "read"],
    feature: "messaging",
  },
  {
    title: "Announcements",
    href: "/dashboard/announcements",
    icon: Megaphone,
    permission: ["announcement", "read"],
    feature: "announcements",
  },
];

const adminNavItems: NavItem[] = [
  {
    title: "Grade Scales",
    href: "/dashboard/grade-scales",
    icon: Scale,
    permission: ["grade-scale", "read"],
  },
  { title: "Roles", href: "/dashboard/roles", icon: KeyRound, adminOnly: true },
  {
    title: "Timetable setup",
    href: "/dashboard/settings/timetable",
    icon: Clock,
    permission: ["school", "update"],
    feature: "timetable",
  },
  {
    title: "Email Domains",
    href: "/dashboard/email-domains",
    icon: AtSign,
    adminOnly: true,
  },
  {
    title: "Report cards",
    href: "/dashboard/reports",
    icon: FileBadge,
    permission: ["report-card", "read"],
    feature: "report_cards",
  },
  {
    title: "Audit log",
    href: "/dashboard/audit-log",
    icon: ClipboardClock,
    permission: ["audit-log", "read"],
  },
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
  useSignals();
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const { can, isAdmin } = usePermissions();
  const { hasFeature } = useFeatures();
  const announcementsOn = hasFeature("announcements");
  const filesOn = hasFeature("files");
  const messagingOn = hasFeature("messaging");
  const collapsed = state === "collapsed";

  // Keep the unread badges fresh as the user navigates.
  useEffect(() => {
    if (announcementsOn) refreshAnnouncementUnread();
    if (filesOn) refreshFileUnread();
    if (messagingOn) refreshChatUnread();
  }, [pathname, announcementsOn, filesOn, messagingOn]);

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      toast.error("Failed to logout");
    }
    router.push("/login");
    toast.success("Logged out");
  }

  const visibleAdminNavItems = adminNavItems.filter(
    (item) =>
      (!item.feature || hasFeature(item.feature)) &&
      (item.adminOnly
        ? isAdmin
        : !item.permission || can(item.permission[0], item.permission[1])),
  );

  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ""}`.trim()
    : profile?.email || "User";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 overflow-hidden"
        >
          {profile?.school?.logo_url ? (
            // The school's own logo replaces the app mark when it has one.
            // eslint-disable-next-line @next/next/no-img-element -- served by the API/CDN
            <img
              src={profile.school.logo_url}
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
          {!collapsed && (
            <div className="min-w-0">
              <span className="text-lg font-bold tracking-tight truncate block">
                GradeBook
              </span>
            </div>
          )}
        </Link>
        {!collapsed && profile?.organisation?.name && (
          <div className="flex items-center gap-1.5 mt-1">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground truncate flex-1">
              {profile.organisation.name}
            </span>
          </div>
        )}
        {!collapsed && profile?.school?.name && (
          <SchoolSwitcher
            schoolName={profile.school.name}
            isOrgAdmin={!!profile.is_org_admin}
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems
                .filter(
                  (item) =>
                    (!item.feature || hasFeature(item.feature)) &&
                    (!item.permission ||
                      can(item.permission[0], item.permission[1])),
                )
                .map((item) => {
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
                        {item.href === "/dashboard/announcements" &&
                          unreadAnnouncements.value > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                              {unreadAnnouncements.value}
                            </span>
                          )}
                        {item.href === "/dashboard/files" &&
                          unreadFiles.value > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                              {unreadFiles.value}
                            </span>
                          )}
                        {item.href === "/dashboard/chat" &&
                          unreadChat.value > 0 && (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                              {unreadChat.value}
                            </span>
                          )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleAdminNavItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleAdminNavItems.map((item) => {
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

        {profile?.is_org_admin && (
          <SidebarGroup>
            <SidebarGroupLabel>Organisation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href={ORGANISATION_PATH} />}
                    tooltip="Organisation"
                  >
                    <Building2 className="size-4" />
                    <span>Organisation</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
                  <p className="font-medium truncate text-sm leading-tight">
                    {displayName}
                  </p>
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
                <p className="text-xs text-muted-foreground truncate">
                  {profile.email}
                </p>
              )}
            </div>
            <DropdownMenuItem
              onClick={() => router.push("/dashboard/settings")}
            >
              <Settings className="mr-2 size-4" />
              Settings
            </DropdownMenuItem>
            {profile?.is_org_admin && (
              <DropdownMenuItem onClick={() => router.push(ORGANISATION_PATH)}>
                <Building2 className="mr-2 size-4" />
                Organisation
              </DropdownMenuItem>
            )}
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
