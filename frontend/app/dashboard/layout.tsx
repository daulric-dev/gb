"use client";

import { useProfile } from "@/lib/use-profile";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = useProfile();

  return (
    <SidebarProvider>
      <AppSidebar profile={profile.value} />
      <SidebarInset>
        <Header />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
