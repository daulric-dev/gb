"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { useOptionalCan, usePermissions } from "@/providers/PermissionsProvider";
import { useFeatures } from "@/hooks/use-features";
import { Card } from "@/components/ui/card";
import { SchoolIntegrations } from "@/components/integrations/school-integrations";

/**
 * Settings > Integrations for the active school's admin: webhooks that send
 * platform events to the school's own systems. Hidden for everyone else and
 * while the organisation has the `integrations` feature off.
 */
export function SchoolIntegrationSettings() {
  useSignals();
  const can = useOptionalCan();
  const { isAdmin } = usePermissions();
  const { hasFeature } = useFeatures();
  if (!isAdmin || !can("school", "update") || !hasFeature("integrations")) return null;

  return (
    <Card id="integrations" className="scroll-mt-28 space-y-4 p-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Send grades, attendance, people and course events to your
          school&apos;s own systems as signed webhooks.
        </p>
      </div>
      <SchoolIntegrations />
    </Card>
  );
}
