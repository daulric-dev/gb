"use client";

import { useProfile } from "@/providers/AuthProvider";
import { PermissionsProvider } from "@/providers/PermissionsProvider";
import { homePathFor, isStudentProfile } from "@/lib/routing";
import { useSetupGate } from "@/lib/setup";
import { ChatProvider } from "@/providers/ChatProvider";
import { useSignals } from "@preact/signals-react/runtime";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { ManagingSchoolBanner } from "@/components/layout/managing-school-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useFeatures } from "@/hooks/use-features";
import { featureForPath } from "@/lib/features";
import { FeatureDisabled } from "@/components/feature-disabled";
import { useEffect } from "react";

export default function DashboardLayout({children}: { children: React.ReactNode }) {
  useSignals();
  const { profile, loading } = useProfile();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { hasFeature } = useFeatures();
  useSetupGate(!loading.value && !!profile.value);

  useEffect(() => {
    if (loading.value) return;
    if (!profile.value) {
      // AuthProvider doesn't redirect on its own; the dashboard does.
      router.replace("/login");
      return;
    }
    // Students get the self-scoped portal, not the staff app. The API would
    // deny them here anyway (no school_management row means PermissionGuard
    // fails closed), so this is about not showing them a wall of 403s.
    if (isStudentProfile(profile.value)) {
      router.replace("/portal");
      return;
    }
    // No school yet: onboarding, the school list, or - for an organisation
    // admin - the organisation console.
    if (!profile.value.school) {
      router.replace(homePathFor(profile.value));
    }
  }, [loading.value, profile.value, router]);

  if (loading.value || !profile.value?.school) return null;
  if (isStudentProfile(profile.value)) return null;

  // A page whose feature is off (a bookmark, an old link) says so instead.
  const pageFeature = featureForPath(pathname);
  const pageOff = pageFeature !== null && !hasFeature(pageFeature);

  // Switching the active school remounts every school-scoped page (and the
  // chat stream), so each refetches for the new school.
  const schoolId = profile.value.school.id;

  return (
    <PermissionsProvider>
      {/* No realtime chat stream at all while messaging is off. */}
      {hasFeature("messaging") && <ChatProvider key={schoolId} />}
      <SidebarProvider>
        <AppSidebar profile={profile.value} />
        <SidebarInset>
          <Header />
          <ManagingSchoolBanner />
          <main className="flex-1 p-4 md:p-6">
            <div key={schoolId} className="mx-auto max-w-6xl">
              {pageOff ? <FeatureDisabled /> : children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PermissionsProvider>
  );
}
