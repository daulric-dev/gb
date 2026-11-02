"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  draftOf,
  draftProblem,
  groupEventTypes,
  groupState,
  isInsecureUrl,
  toggleEvent,
  toggleGroup,
  webhookPatch,
  webhooksApi,
  type EventTypeCatalog,
  type Webhook,
  type WebhookDraft,
  type WebhookWithSecret,
} from "@/lib/webhooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Add a webhook (existing = null) or change one: name, URL (a warning for
 * plain http), the event types grouped from the catalog with an "all in this
 * group" toggle each, and on/off. Saving needs step-up confirmation.
 */
export function WebhookFormDialog({
  open,
  existing,
  apiBase,
  catalog,
  onOpenChangeAction,
  onCreatedAction,
  onSavedAction,
}: {
  open: boolean;
  existing: Webhook | null;
  apiBase?: string;
  catalog: EventTypeCatalog | null;
  onOpenChangeAction: (open: boolean) => void;
  onCreatedAction: (result: WebhookWithSecret) => void;
  onSavedAction: (webhook: Webhook) => void;
}) {
  const [draft, setDraft] = useState<WebhookDraft>(() => draftOf(existing));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(draftOf(existing));
  }, [open, existing]);

  const set = (patch: Partial<WebhookDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = draftProblem(draft);
  const patch = existing ? webhookPatch(existing, draft) : null;
  const groups = catalog ? groupEventTypes(catalog) : [];
  const idPrefix = `webhook-${existing?.id ?? "new"}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      if (existing) {
        if (!patch) return onOpenChangeAction(false);
        const saved = await api<Webhook>(`${webhooksApi(apiBase)}/${existing.id}`, {
          method: "PATCH",
          body: patch,
          stepUp: true,
        });
        toast.success("Webhook saved");
        onSavedAction(saved);
      } else {
        const created = await api<WebhookWithSecret>(webhooksApi(apiBase), {
          method: "POST",
          body: { ...draft, name: draft.name.trim(), url: draft.url.trim() },
          stepUp: true,
        });
        toast.success("Webhook added");
        onCreatedAction(created);
      }
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save the webhook");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit webhook" : "Add webhook"}</DialogTitle>
            <DialogDescription>
              GradeBook POSTs each chosen event as signed JSON to this URL. Add
              more webhooks to send different events to different systems.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-name`}>Name</Label>
            <Input
              id={`${idPrefix}-name`}
              value={draft.name}
              maxLength={100}
              placeholder="Student information system"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-url`}>URL</Label>
            <Input
              id={`${idPrefix}-url`}
              value={draft.url}
              maxLength={2048}
              inputMode="url"
              placeholder="https://sis.example.edu/gradebook-events"
              onChange={(e) => set({ url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Any http or https address, including ones on your own network.
            </p>
            {isInsecureUrl(draft.url) && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400" role="alert">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Plain http sends names, emails and marks unencrypted. Use https
                unless the receiver is on a network you trust.
              </p>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Events</legend>
            {!catalog && <p className="text-sm text-muted-foreground">Loading event types…</p>}
            {groups.map((g) => {
              const keys = g.types.map((t) => t.key);
              const state = groupState(draft.events, keys);
              return (
                <div key={g.key} className="rounded-lg border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={state === "all"}
                      indeterminate={state === "some"}
                      onCheckedChange={(on) => set({ events: toggleGroup(draft.events, keys, !!on) })}
                      aria-label={`All events in ${g.label}`}
                    />
                    {g.label}
                    <span className="text-xs font-normal text-muted-foreground">All events in this group</span>
                  </label>
                  <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
                    {g.types.map((t) => (
                      <label key={t.key} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={draft.events.includes(t.key)}
                          onCheckedChange={(on) => set({ events: toggleEvent(draft.events, t.key, !!on) })}
                        />
                        <span className="min-w-0">
                          <span className="block">{t.label}</span>
                          <code className="block text-xs text-muted-foreground">{t.key}</code>
                          <span className="block text-xs text-muted-foreground">{t.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${idPrefix}-enabled`}>Send events</Label>
            <Switch
              id={`${idPrefix}-enabled`}
              checked={draft.enabled}
              onCheckedChange={(v) => set({ enabled: v })}
            />
          </div>

          {problem && draft.name && <p className="text-sm text-destructive">{problem}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || saving || (!!existing && !patch)}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {existing ? "Save" : "Add webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
