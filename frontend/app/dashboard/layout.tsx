"use client";

import { useProfile } from "@/lib/use-profile";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { bootstrapSession } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useSignal, useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useSignals();
  const isReady = useSignal(false);
  const router = useRouter();
  const { profile } = useProfile();
  
  useEffect(() => {
    bootstrapSession().then((ok) => {
      if (!ok) { 
        router.push("/login");
        return;
      };

      isReady.value = true;
      
    })
  })

  if (!isReady.value) return null;

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
