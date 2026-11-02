"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  applyFeatureToggle,
  changedFeatures,
  type SchoolFeature,
} from "@/lib/features";
import { CURRENT_SCHOOL_API } from "@/lib/organisation";
import { useAuth } from "@/providers/AuthProvider";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { FeatureToggleList } from "@/components/features/feature-toggle-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ORG_LOCKED = "Turned off by your organisation";

/** What the school has chosen; a feature the organisation turned off is off. */
function toMap(list: SchoolFeature[]): Record<string, boolean> {
  return Object.fromEntries(
    list.map((f) => [f.key, f.availableInOrganisation && f.enabledForSchool]),
  );
}

/**
 * The school's feature switches. The school can switch off what the
 * organisation allows, never switch on what it has turned off. By default the
 * active school's (school:update only); the organisation console passes one
 * school's `apiBase` and `canEdit`.
 */
export function SchoolFeatureSettings({
  apiBase = CURRENT_SCHOOL_API,
  canEdit,
}: {
  apiBase?: string;
  canEdit?: boolean;
} = {}) {
  const can = useOptionalCan();
  if (!(canEdit ?? can("school", "update"))) return null;
  return <SchoolFeatureCard key={apiBase} path={`${apiBase}/features`} />;
}

function SchoolFeatureCard({ path }: { path: string }) {
  const { refreshSilently } = useAuth();
  const [features, setFeatures] = useState<SchoolFeature[] | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<SchoolFeature[]>(path)
      .then((list) => {
        setFeatures(list);
        setDraft(toMap(list));
      })
      .catch((err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Failed to load features",
        ),
      );
  }, [path]);

  const changes = features ? changedFeatures(toMap(features), draft) : {};
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const list = await api<SchoolFeature[]>(path, {
        method: "PATCH",
        body: { features: changes },
      });
      setFeatures(list);
      setDraft(toMap(list));
      toast.success("Features saved");
      // Navigation everywhere reads the profile's features.
      void refreshSilently();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save features",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Features</h2>
          <p className="text-sm text-muted-foreground">
            Switch off features the school does not use. Features your
            organisation has turned off cannot be switched on here.
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save
        </Button>
      </div>

      {!features ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <FeatureToggleList
          rows={features.map((f) => ({
            ...f,
            lockedReason: f.availableInOrganisation ? null : ORG_LOCKED,
          }))}
          value={draft}
          disabled={saving}
          onToggle={(key, on) =>
            setDraft((d) => applyFeatureToggle(d, features, key, on))
          }
        />
      )}
    </Card>
  );
}
