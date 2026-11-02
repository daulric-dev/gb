"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { useProfile } from "@/providers/AuthProvider";
import { useOptionalCan, usePermissions } from "@/providers/PermissionsProvider";
import { Card } from "@/components/ui/card";
import { SchoolSingleSignOn } from "@/app/dashboard/email-domains/_components/SchoolSingleSignOn";

/**
 * Settings > Single sign-on for the active school's admin: its own sign-in
 * apps and email domains (the same section as the Email domains page and a
 * school's page in the organisation console). Hidden for everyone else.
 */
export function SchoolSsoSettings() {
  useSignals();
  const can = useOptionalCan();
  // The domain routes sit behind AdminGuard; the app routes need school:update.
  const { isAdmin } = usePermissions();
  const { profile } = useProfile();
  if (!isAdmin || !can("school", "update")) return null;
  const schoolName = profile.value?.school?.name ?? "your school";

  return (
    <Card id="single-sign-on" className="scroll-mt-28 space-y-4 p-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">Single sign-on</h2>
        <p className="text-sm text-muted-foreground">
          Let people sign in with {schoolName}&apos;s Google Workspace,
          Microsoft or SAML account instead of an emailed code, and join the
          school by their email domain.
        </p>
      </div>
      <SchoolSingleSignOn schoolName={schoolName} />
    </Card>
  );
}
