"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useFeatures } from "@/hooks/use-features";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { userMessage } from "@/lib/errors";
import { similarityApi, type SimilaritySettings } from "@/lib/similarity";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * The school's similarity check settings (`school:update`, while
 * `similarity_check` is on): what submissions are compared with, and the
 * percentage at which teachers see a marker.
 */
export function SchoolSimilaritySettings() {
  useSignals();
  const { hasFeature } = useFeatures();
  const can = useOptionalCan();
  const allowed = hasFeature("similarity_check") && can("school", "update");
  const current = useSignal<SimilaritySettings | null>(null);
  const pool = useSignal<"activity" | "school">("activity");
  const terms = useSignal("2");
  const threshold = useSignal("40");
  const saving = useSignal(false);

  useEffect(() => {
    if (!allowed) return;
    similarityApi
      .settings()
      .then((s) => {
        current.value = s;
        pool.value = s.pool;
        terms.value = String(s.poolTerms);
        threshold.value = String(s.threshold);
      })
      .catch(() => toast.error("Failed to load the similarity settings"));
  }, [allowed, current, pool, terms, threshold]);

  if (!allowed || !current.value) return null;

  async function save() {
    saving.value = true;
    try {
      current.value = await similarityApi.saveSettings({
        pool: pool.value,
        poolTerms: Number(terms.value),
        threshold: Number(threshold.value),
      });
      toast.success("Similarity settings saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the similarity settings"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Similarity check</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Text answers are compared with other students&rsquo; work in this school only (never an
        external database). Teachers see a quiet marker above the threshold; students never see
        anything and grades never change. A marker is a prompt to look, not proof.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="sim-pool">Compare with</Label>
          <NativeSelect
            id="sim-pool"
            className="w-full"
            value={pool.value}
            onChange={(e) => (pool.value = e.target.value as "activity" | "school")}
          >
            <NativeSelectOption value="activity">The same activity only</NativeSelectOption>
            <NativeSelectOption value="school">The whole school, recent terms</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sim-terms">Recent terms</Label>
          <Input
            id="sim-terms"
            type="number"
            min={1}
            max={12}
            disabled={pool.value !== "school"}
            value={terms.value}
            onChange={(e) => (terms.value = e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sim-threshold">Marker at (%)</Label>
          <Input
            id="sim-threshold"
            type="number"
            min={10}
            max={100}
            value={threshold.value}
            onChange={(e) => (threshold.value = e.target.value)}
          />
        </div>
      </div>
      <Button className="mt-4" size="sm" disabled={saving.value} onClick={() => void save()}>
        {saving.value && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
        Save
      </Button>
    </Card>
  );
}
