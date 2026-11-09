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
  type OrganisationFeature,
} from "@/lib/features";
import { useAuth } from "@/providers/AuthProvider";
import { FeatureToggleList } from "@/components/features/feature-toggle-list";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgHeader } from "../_components/org-header";
import { userMessage } from "@/lib/errors";

function toMap(list: OrganisationFeature[]): Record<string, boolean> {
  return Object.fromEntries(list.map((f) => [f.key, f.enabled]));
}

export default function OrganisationFeaturesPage() {
  useSignals();
  const { refreshSilently } = useAuth();
  const featuresSignal = useSignal<OrganisationFeature[] | null>(null);
  const features = featuresSignal.value;
  const draftSignal = useSignal<Record<string, boolean>>({});
  const draft = draftSignal.value;
  const savingSignal = useSignal(false);
  const saving = savingSignal.value;

  useEffect(() => {
    api<OrganisationFeature[]>("/organisation/features")
      .then((list) => {
        featuresSignal.value = list;
        draftSignal.value = toMap(list);
      })
      .catch((err) => toast.error(userMessage(err, "Failed to load features")));
  }, [draftSignal, featuresSignal]);

  const changes = features ? changedFeatures(toMap(features), draft) : {};
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!features || !dirty) return;
    savingSignal.value = true;
    try {
      const list = await api<OrganisationFeature[]>("/organisation/features", {
        method: "PATCH",
        body: { features: changes },
      });
      featuresSignal.value = list;
      draftSignal.value = toMap(list);
      toast.success("Features saved");
      // The admin's own school may have just gained or lost something.
      void refreshSilently();
    } catch (err) {
      toast.error(userMessage(err, "Failed to save features"));
    } finally {
      savingSignal.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Features"
        description="Switch platform features on or off for every school"
        action={
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        }
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Platform features</CardTitle>
          <CardDescription>
            A feature switched off here is off in every school. School
            administrators can switch off what you allow, but cannot switch on
            what you have turned off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!features ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <FeatureToggleList
              rows={features}
              value={draft}
              disabled={saving}
              onToggle={(key, on) =>
                (draftSignal.value = applyFeatureToggle(draftSignal.value, features, key, on))
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
