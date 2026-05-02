"use client";

import { useProfile } from "@/lib/use-profile";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { bootstrapSession, getAccessToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function DashboardContent({ children }: { children: React.ReactNode }) {
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (getAccessToken()) {
      setReady(true);
      return;
    }

    bootstrapSession().then((ok) => {
      if (!ok) {
        router.push("/login");
        return;
      }
      setReady(true);
    });
  }, []);

  if (!ready) return null;

  return <DashboardContent>{children}</DashboardContent>;
}
