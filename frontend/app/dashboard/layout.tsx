"use client";

import { Header } from "@/components/header";
import { useProfile } from "@/lib/use-profile";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = useProfile();

  return (
    <>
      <Header profile={profile} />
      <main className="min-h-screen pt-8 p-4 bg-background">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </>
  );
}
