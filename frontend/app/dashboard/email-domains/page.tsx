"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { usePermissions } from "@/providers/PermissionsProvider";
import { useProfile } from "@/providers/AuthProvider";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { PermissionDenied } from "@/components/dashboard/permission-denied";
import { Skeleton } from "@/components/ui/skeleton";
import { SchoolSingleSignOn } from "./_components/SchoolSingleSignOn";

const TITLE = "Email Domains";
const DESCRIPTION = "Let people with a school email address join automatically and sign in with your school's single sign-on";

/**
 * The active school's single sign-on, for its admin: the school's own
 * sign-in apps (Google, Microsoft) and its email domains, each picking one of
 * the providers the school has. Also reachable from Settings.
 */
export default function EmailDomainsPage() {
  useSignals();
  // The endpoints sit behind AdminGuard, so this mirrors that.
  const { isAdmin, loading: permissionsLoading } = usePermissions();
  const { profile } = useProfile();
  const schoolName = profile.value?.school?.name ?? "your school";

  if (permissionsLoading.value) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!isAdmin) {
    return (
      <PermissionDenied
        title={TITLE}
        description={DESCRIPTION}
        message="Only school administrators can manage email domains."
      />
    );
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={TITLE} description={DESCRIPTION} />
      <SchoolSingleSignOn schoolName={schoolName} />
    </div>
  );
}
