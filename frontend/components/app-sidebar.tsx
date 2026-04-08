"use client";

import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, GraduationCap, Users, LogOut } from "lucide-react";
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
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
];

function getInitials(profile: UserProfile | null) {
  if (!profile?.first_name) return "?";
  const first = profile.first_name?.[0] || "";
  const last = profile.last_name?.[0] || "";
  return `${first}${last}`.toUpperCase();
}

export function AppSidebar({ profile }: { profile: UserProfile | null }) {
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
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">GradeBook</span>
        {profile?.school && (
          <span className="text-xs text-muted-foreground truncate">
            {profile.school.name}
          </span>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<a href={item.href} />}
                    isActive={
                      item.href === "/dashboard"
                        ? pathname === "/dashboard"
                        : pathname.startsWith(item.href)
                    }
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent transition-colors" />
            }
          >
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">
                {getInitials(profile)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left truncate">
              <p className="font-medium truncate">{displayName}</p>
              {profile?.role && (
                <p className="text-xs text-muted-foreground capitalize">
                  {profile.role}
                </p>
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
