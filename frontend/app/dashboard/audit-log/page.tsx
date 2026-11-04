"use client";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { AuditLogView } from "@/components/audit-log-view";

export default function AuditLogPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Audit log"
        description="Review changes made to records in this school."
      />
      <AuditLogView endpoint="/schools/current/audit-log" />
    </div>
  );
}
