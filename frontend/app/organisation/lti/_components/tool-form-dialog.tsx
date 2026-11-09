"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  ORGANISATION_LTI_API,
  ltiToolApi,
  toolCreateBody,
  toolDraftOf,
  toolDraftProblem,
  toolPatch,
  type LtiTool,
  type ToolDraft,
  type ToolKeyMode,
} from "@/lib/lti";
import type { OrganisationSchool } from "@/lib/organisation";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const RADIO_CARD =
  "flex cursor-pointer items-center gap-2 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5";

/**
 * Register a tool (existing = null) or change one. Schools are chosen when
 * registering; afterwards they are managed as deployments on the tool.
 * Saving needs step-up confirmation.
 */
export function ToolFormDialog({
  open,
  existing,
  schools,
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  existing: LtiTool | null;
  schools: OrganisationSchool[] | null;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: (tool: LtiTool) => void;
}) {
  useSignals();
  // Fresh fields each time: the parent remounts this (key) when it opens.
  // useSignal keeps only the first render's value, like a lazy initial state.
  const draftSignal = useSignal<ToolDraft>(toolDraftOf(existing));
  const draft = draftSignal.value;
  const saving = useSignal(false);
  const set = (patch: Partial<ToolDraft>) => (draftSignal.value = { ...draftSignal.value, ...patch });
  const problem = toolDraftProblem(draft);
  const id = `lti-tool-${existing?.id ?? "new"}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return toast.error(problem);
    saving.value = true;
    try {
      let saved: LtiTool;
      if (existing) {
        const patch = toolPatch(existing, draft);
        if (!patch) return onOpenChangeAction(false);
        saved = await api<LtiTool>(ltiToolApi(existing.id), {
          method: "PATCH",
          body: patch,
          stepUp: true,
        });
        toast.success("Tool saved");
      } else {
        saved = await api<LtiTool>(`${ORGANISATION_LTI_API}/tools`, {
          method: "POST",
          body: toolCreateBody(draft),
          stepUp: true,
        });
        toast.success("Tool registered. Give it the values shown under it.");
      }
      onSavedAction(saved);
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the tool"));
    } finally {
      saving.value = false;
    }
  }

  const toggleSchool = (schoolId: string, on: boolean) =>
    set({
      schoolIds: on
        ? [...new Set([...draft.schoolIds, schoolId])]
        : draft.schoolIds.filter((s) => s !== schoolId),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : "Register a tool"}</DialogTitle>
            <DialogDescription>
              Copy these values from the tool&apos;s LTI 1.3 set-up page. GradeBook issues the
              client id and deployment ids for you to give back to it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={draft.name}
              maxLength={100}
              placeholder="Practice quizzes"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-description`}>Description (optional)</Label>
            <Input
              id={`${id}-description`}
              value={draft.description}
              maxLength={500}
              placeholder="Shown to teachers when they add the tool"
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-login`}>Login initiation URL</Label>
            <Input
              id={`${id}-login`}
              value={draft.loginUrl}
              maxLength={2048}
              inputMode="url"
              placeholder="https://tool.example.com/lti/login"
              onChange={(e) => set({ loginUrl: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-launch`}>Launch URL</Label>
            <Input
              id={`${id}-launch`}
              value={draft.targetLinkUri}
              maxLength={2048}
              inputMode="url"
              placeholder="https://tool.example.com/lti/launch"
              onChange={(e) => set({ targetLinkUri: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-redirects`}>Redirect URLs</Label>
            <Textarea
              id={`${id}-redirects`}
              rows={3}
              className="font-mono text-xs"
              value={draft.redirectUris}
              placeholder="https://tool.example.com/lti/launch"
              onChange={(e) => set({ redirectUris: e.target.value })}
              aria-describedby={`${id}-redirects-hint`}
            />
            <p id={`${id}-redirects-hint`} className="text-xs text-muted-foreground">
              One per line, at most 20. Launches only go to an exact match.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">The tool&apos;s signing key</legend>
            <RadioGroup
              value={draft.keyMode}
              onValueChange={(v) => set({ keyMode: v as ToolKeyMode })}
              className="grid-cols-1 sm:grid-cols-2"
            >
              <Label className={RADIO_CARD}>
                <RadioGroupItem value="jwks" />
                JWKS URL (recommended)
              </Label>
              <Label className={RADIO_CARD}>
                <RadioGroupItem value="pem" />
                Public key (PEM)
              </Label>
            </RadioGroup>
            {draft.keyMode === "jwks" ? (
              <Input
                aria-label="Tool JWKS URL"
                value={draft.jwksUrl}
                maxLength={2048}
                inputMode="url"
                placeholder="https://tool.example.com/.well-known/jwks.json"
                onChange={(e) => set({ jwksUrl: e.target.value })}
              />
            ) : (
              <Textarea
                aria-label="Tool public key in PEM format"
                rows={5}
                className="font-mono text-xs"
                value={draft.publicKeyPem}
                maxLength={8192}
                placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
                onChange={(e) => set({ publicKeyPem: e.target.value })}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Used to check the tool&apos;s requests for grade passback. A JWKS URL lets the tool
              rotate its keys without you changing anything.
            </p>
          </fieldset>

          <div className="space-y-3 rounded-lg border p-3">
            <ToggleRow
              id={`${id}-ags`}
              label="Grade passback (AGS)"
              hint="Teachers can give an item points; the tool sends scores to that gradebook column."
              checked={draft.agsEnabled}
              onChange={(v) => set({ agsEnabled: v })}
            />
            <ToggleRow
              id={`${id}-name-claim`}
              label="Send name"
              hint="The person's first and last name."
              checked={draft.sendName}
              onChange={(v) => set({ sendName: v })}
            />
            <ToggleRow
              id={`${id}-email-claim`}
              label="Send email"
              hint="The person's email address."
              checked={draft.sendEmail}
              onChange={(v) => set({ sendEmail: v })}
            />
            <p className="text-xs text-muted-foreground">
              Otherwise the tool only receives an anonymous id, different for every tool, plus the
              person&apos;s role and the course.
            </p>
            <ToggleRow
              id={`${id}-enabled`}
              label="Enabled"
              hint="Off: teachers cannot add it and nobody can launch it. Existing items stay."
              checked={draft.enabled}
              onChange={(v) => set({ enabled: v })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-custom`}>Custom parameters (optional)</Label>
            <Textarea
              id={`${id}-custom`}
              rows={3}
              className="font-mono text-xs"
              value={draft.customParams}
              placeholder={"region=eu\ntheme=dark"}
              onChange={(e) => set({ customParams: e.target.value })}
              aria-describedby={`${id}-custom-hint`}
            />
            <p id={`${id}-custom-hint`} className="text-xs text-muted-foreground">
              One name=value per line (letters, digits and _ in names), sent on every launch. An
              item&apos;s own parameters override these.
            </p>
          </div>

          {!existing && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Schools</legend>
              <RadioGroup
                value={draft.allSchools ? "all" : "selected"}
                onValueChange={(v) => set({ allSchools: v === "all" })}
                className="grid-cols-1 sm:grid-cols-2"
              >
                <Label className={RADIO_CARD}>
                  <RadioGroupItem value="all" />
                  Every school
                </Label>
                <Label className={RADIO_CARD}>
                  <RadioGroupItem value="selected" />
                  Selected schools
                </Label>
              </RadioGroup>
              {!draft.allSchools &&
                (schools === null ? (
                  <p className="text-sm text-muted-foreground">Loading schools…</p>
                ) : schools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No schools yet.</p>
                ) : (
                  <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                    {schools.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draft.schoolIds.includes(s.id)}
                          onCheckedChange={(on) => toggleSchool(s.id, !!on)}
                        />
                        <span className="min-w-0 truncate">{s.name}</span>
                        {!s.isActive && (
                          <span className="text-xs text-muted-foreground">(inactive)</span>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              <p className="text-xs text-muted-foreground">
                Each choice gets its own deployment id. You can add or remove schools later.
              </p>
            </fieldset>
          )}

          {problem && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {existing ? "Save" : "Register tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}
