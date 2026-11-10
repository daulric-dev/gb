"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
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
import { userMessage } from "@/lib/errors";

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
  useSignals();
  const { refreshSilently } = useAuth();
  const features = useSignal<SchoolFeature[] | null>(null);
  const draft = useSignal<Record<string, boolean>>({});
  const saving = useSignal(false);

  useEffect(() => {
    api<SchoolFeature[]>(path)
      .then((list) => {
        features.value = list;
        draft.value = toMap(list);
      })
      .catch((err) =>
        toast.error(
          userMessage(err, "Failed to load features"),
        ),
      );
  }, [path, draft, features]);

  const changes = features.value ? changedFeatures(toMap(features.value), draft.value) : {};
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!dirty) return;
    saving.value = true;
    try {
      const list = await api<SchoolFeature[]>(path, {
        method: "PATCH",
        body: { features: changes },
      });
      features.value = list;
      draft.value = toMap(list);
      toast.success("Features saved");
      // Navigation everywhere reads the profile's features.
      void refreshSilently();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save features"));
    } finally {
      saving.value = false;
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
        <Button size="sm" onClick={save} disabled={!dirty || saving.value}>
          {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save
        </Button>
      </div>

      {!features.value ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <FeatureToggleList
          rows={features.value.map((f) => ({
            ...f,
            lockedReason: f.availableInOrganisation ? null : ORG_LOCKED,
          }))}
          value={draft.value}
          disabled={saving.value}
          onToggle={(key, on) =>
            (draft.value = applyFeatureToggle(draft.value, features.value ?? [], key, on))
          }
        />
      )}
    </Card>
  );
}
