"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useFeatures } from "@/hooks/use-features";
import { useOptionalCan } from "@/providers/PermissionsProvider";
import { userMessage } from "@/lib/errors";
import {
  aiSchoolApi,
  ORG_DEFAULT_CHOICE,
  orgDefaultLabel,
  PROVIDER_KIND_LABEL,
  type AiSchoolSettings,
} from "@/lib/ai";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

/**
 * The school's AI settings (`school:update`, while `ai_assistance` is on):
 * which of the organisation's providers the school uses (the organisation
 * default or one it made available to schools; the model is set by the
 * organisation), the data notice naming that provider, and whether
 * students' work may be sent for rubric feedback suggestions (off by
 * default). The whole feature is switched off for the school under Features.
 */
export function SchoolAiSettings() {
  useSignals();
  const id = useId();
  const { hasFeature } = useFeatures();
  const can = useOptionalCan();
  const allowed = hasFeature("ai_assistance") && can("school", "update");
  const status = useSignal<AiSchoolSettings | null>(null);
  const saving = useSignal(false);

  useEffect(() => {
    if (!allowed) return;
    aiSchoolApi
      .get()
      .then((s) => (status.value = s))
      .catch(() => toast.error("Failed to load the AI settings"));
  }, [allowed, status]);

  if (!allowed || !status.value) return null;
  const s = status.value;

  async function save(body: { allowStudentWork?: boolean; providerId?: string | null }) {
    saving.value = true;
    try {
      status.value = await aiSchoolApi.save(body);
      toast.success("AI settings saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the AI settings"));
    } finally {
      saving.value = false;
    }
  }

  const choice = s.choiceUnavailable ? ORG_DEFAULT_CHOICE : (s.providerId ?? ORG_DEFAULT_CHOICE);
  // The default is listed once, as "Organisation default (X)".
  const others = s.availableProviders.filter((p) => p.id !== s.organisationDefault?.id || s.providerId === p.id);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">AI assistance</h2>

      <div className="mt-2 mb-4 space-y-1.5">
        <Label htmlFor={`${id}-provider`}>AI provider</Label>
        <NativeSelect
          id={`${id}-provider`}
          className="w-full sm:w-96"
          value={choice}
          disabled={saving.value}
          aria-describedby={`${id}-provider-help ${id}-notice`}
          onChange={(e) =>
            void save({ providerId: e.target.value === ORG_DEFAULT_CHOICE ? null : e.target.value })
          }
        >
          <NativeSelectOption value={ORG_DEFAULT_CHOICE}>{orgDefaultLabel(s.organisationDefault)}</NativeSelectOption>
          {others.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name} ({PROVIDER_KIND_LABEL[p.kind] ?? p.kind} · {p.model})
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p id={`${id}-provider-help`} className="text-xs text-muted-foreground">
          Your organisation sets up the AI providers and their models; you choose which one your
          school uses.
          {s.choiceUnavailable &&
            " The provider your school chose is no longer offered, so the organisation default is used."}
        </p>
      </div>

      <p id={`${id}-notice`} className="mb-4 text-sm text-muted-foreground">
        {s.notice}
      </p>

      <label htmlFor={`${id}-work`} className="flex items-start justify-between gap-4 text-sm">
        <span>
          Allow sending student work to the AI provider
          <span id={`${id}-work-help`} className="block text-xs text-muted-foreground">
            Lets teachers ask for rubric feedback suggestions, which sends the text a student
            handed in (names and emails replaced) to {s.provider ? `"${s.provider.name}"` : "the provider"}.
            Off by default. Files are never sent.
          </span>
        </span>
        <Switch
          id={`${id}-work`}
          aria-describedby={`${id}-work-help`}
          checked={s.allowStudentWork}
          disabled={saving.value}
          onCheckedChange={(v) => void save({ allowStudentWork: v })}
        />
      </label>
    </Card>
  );
}
