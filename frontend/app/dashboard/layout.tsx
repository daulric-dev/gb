"use client";

import { useProfile } from "@/providers/AuthProvider";
import { useSignals } from "@preact/signals-react/runtime";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();
  const { profile, loading } = useProfile();
  const router = useRouter();

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      // AuthProvider doesn't redirect on its own; the dashboard does.
      router.replace("/login");
      return;
    }
    if (!profile.value.school) {
      router.replace("/schools");
    }
  }, [loading.value, profile.value, router]);

  if (loading.value || !profile.value?.school) return null;

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
