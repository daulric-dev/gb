"use client";

import { AccountSettings } from "@/components/account/account-settings";
import { OrgHeader } from "../_components/org-header";

export default function OrganisationAccountPage() {
  return (
    <div className="space-y-6">
      <OrgHeader
        title="Your account"
        description="Your profile, sign-ins and account"
      />
      <AccountSettings />
    </div>
  );
}
