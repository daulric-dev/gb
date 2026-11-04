"use client";

import { OrgHeader } from "../_components/org-header";
import { AuditLogView } from "@/components/audit-log-view";

export default function OrganisationAuditLogPage() {
  return (
    <div className="space-y-6">
      <OrgHeader
        title="Audit log"
        description="Review changes across every school in your organisation."
      />
      <AuditLogView endpoint="/organisation/audit-log" />
    </div>
  );
}
