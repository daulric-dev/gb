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
 * organisation), the data notice naming that provider, whether students'
 * work may be sent for marking suggestions, and whether the text of their
 * uploaded files may be sent for AI grading drafts (both off by default;
 * changes need step-up). The whole feature is switched off for the school under Features.
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

  async function save(body: { allowStudentWork?: boolean; allowStudentFiles?: boolean; providerId?: string | null }) {
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
            Lets teachers ask for marking suggestions, which sends the text a student typed in
            (names, emails and phone numbers replaced) to {s.provider ? `"${s.provider.name}"` : "the provider"}.
            Off by default. Files are sent only with the next setting on as well.
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

      <label htmlFor={`${id}-files`} className="mt-4 flex items-start justify-between gap-4 text-sm">
        <span>
          Allow sending uploaded files to the AI provider
          <span id={`${id}-files-help`} className="block text-xs text-muted-foreground">
            Lets teachers ask for AI marking drafts of work handed in as files. GradeBook reads the
            text of PDFs (with a text layer), Word .docx, plain text, Markdown and code files on its own
            server, replaces names, emails and phone numbers, cuts long work to a set length and sends
            only that text to {s.provider ? `"${s.provider.name}"` : "the provider"}. Images, scanned
            pages and other files are never sent. Students whose record restricts AI are always left
            out. The AI&apos;s suggestion is kept as a draft for the teacher (never shown to students)
            until the teacher saves a mark or discards it, and is deleted automatically after a set
            period. Off by default; needs the setting above on too.
          </span>
        </span>
        <Switch
          id={`${id}-files`}
          aria-describedby={`${id}-files-help`}
          checked={!!s.allowStudentFiles}
          disabled={saving.value || !s.allowStudentWork}
          onCheckedChange={(v) => void save({ allowStudentFiles: v })}
        />
      </label>
    </Card>
  );
}
