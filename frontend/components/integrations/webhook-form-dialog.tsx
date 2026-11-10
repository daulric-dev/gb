"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  createBody,
  draftOf,
  draftProblem,
  MAX_HEADER_NAME,
  MAX_HEADER_VALUE,
  MAX_HEADERS,
  newHeaderDraft,
  groupEventTypes,
  groupState,
  isInsecureUrl,
  MAX_CA_BYTES,
  toggleEvent,
  toggleGroup,
  webhookPatch,
  webhooksApi,
  type EventTypeCatalog,
  type HeaderDraft,
  type Webhook,
  type WebhookDraft,
  type WebhookWithSecret,
} from "@/lib/webhooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { userMessage } from "@/lib/errors";
import { SecretInput } from "./secret-input";

/**
 * Add a webhook (existing = null) or change one: name, URL (a warning for
 * plain http), the event types grouped from the catalog with an "all in this
 * group" toggle each, optional custom headers (edited like environment
 * variables: values are write-only, a saved one is kept when left blank),
 * optionally the admin's own signing secret (new webhooks), and on/off.
 * Saving needs step-up confirmation.
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
  // Fresh fields each time: the parent remounts this (key) when it opens.
  useSignals();
  const draft = useSignal<WebhookDraft>(draftOf(existing));
  const saving = useSignal(false);

  const set = (patch: Partial<WebhookDraft>) => (draft.value = { ...draft.value, ...patch });
  const setHeader = (key: string, patch: Partial<HeaderDraft>) =>
    (draft.value = {
      ...draft.value,
      headers: draft.value.headers.map((h) => (h.key === key ? { ...h, ...patch } : h)),
    });
  const unreadable = new Set(existing?.headers.filter((h) => h.valueUnreadable).map((h) => h.id) ?? []);
  const problem = draftProblem(draft.value);
  const patch = existing ? webhookPatch(existing, draft.value) : null;
  const groups = catalog ? groupEventTypes(catalog) : [];
  const idPrefix = `webhook-${existing?.id ?? "new"}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    saving.value = true;
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
          body: createBody(draft.value),
          stepUp: true,
        });
        toast.success(created.secretGenerated ? "Webhook added" : "Webhook added with your signing secret");
        onCreatedAction(created);
      }
      onOpenChangeAction(false);
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the webhook"));
    } finally {
      saving.value = false;
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
              value={draft.value.name}
              maxLength={100}
              placeholder="Student information system"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-url`}>URL</Label>
            <Input
              id={`${idPrefix}-url`}
              value={draft.value.url}
              maxLength={2048}
              inputMode="url"
              placeholder="https://sis.example.edu/gradebook-events"
              onChange={(e) => set({ url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Any http or https address, including ones on your own network.
            </p>
            {isInsecureUrl(draft.value.url) && (
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
              const state = groupState(draft.value.events, keys);
              return (
                <div key={g.key} className="rounded-lg border p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={state === "all"}
                      indeterminate={state === "some"}
                      onCheckedChange={(on) => set({ events: toggleGroup(draft.value.events, keys, !!on) })}
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
                          checked={draft.value.events.includes(t.key)}
                          onCheckedChange={(on) => set({ events: toggleEvent(draft.value.events, t.key, !!on) })}
                        />
                        <span className="min-w-0">
                          <span className="block">{t.label}</span>
                          <code className="block text-xs text-muted-foreground">{t.key}</code>
                          <span className="block text-xs text-muted-foreground">{t.description}</span>
                          {t.exampleMessage && (
                            <span className="block text-xs text-muted-foreground italic">
                              e.g. &ldquo;{t.exampleMessage}&rdquo;
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Headers (optional)</legend>
            <p className="text-xs text-muted-foreground">
              Only needed if your endpoint expects a key, e.g. <code>Authorization: Bearer …</code> or{" "}
              <code>X-API-Key</code>. Values are stored encrypted and never shown again.
            </p>
            {draft.value.headers.map((h, i) => (
              <div key={h.key} className="space-y-1">
                <div className="flex items-start gap-2">
                  <Input
                    className="w-2/5 font-mono text-sm"
                    value={h.name}
                    maxLength={MAX_HEADER_NAME}
                    placeholder="X-API-Key"
                    aria-label={`Header ${i + 1} name`}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setHeader(h.key, { name: e.target.value })}
                  />
                  <div className="min-w-0 flex-1">
                    <SecretInput
                      value={h.value}
                      maxLength={MAX_HEADER_VALUE}
                      placeholder={h.id ? "Saved — leave blank to keep" : "Value"}
                      label={`header ${i + 1} value`}
                      onChangeAction={(value) => setHeader(h.key, { value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove header ${h.name || i + 1}`}
                    onClick={() => set({ headers: draft.value.headers.filter((x) => x.key !== h.key) })}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {h.id && unreadable.has(h.id) && !h.value && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    This value can no longer be read (the server&apos;s AUTH_SECRET changed). Enter it again.
                  </p>
                )}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={draft.value.headers.length >= MAX_HEADERS}
              onClick={() => set({ headers: [...draft.value.headers, newHeaderDraft()] })}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add header
            </Button>
          </fieldset>

          {!existing && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-signing-secret`}>Use my own signing secret (optional)</Label>
              <SecretInput
                id={`${idPrefix}-signing-secret`}
                value={draft.value.signingSecret}
                maxLength={256}
                placeholder="Leave blank to generate one"
                label="signing secret"
                onChangeAction={(signingSecret) => set({ signingSecret })}
              />
              <p className="text-xs text-muted-foreground">
                If your receiver already has a secret for checking X-GradeBook-Signature, enter it
                (16-256 characters). Otherwise GradeBook generates one and shows it once.
              </p>
            </div>
          )}

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Security</legend>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor={`${idPrefix}-verify-tls`}>Verify SSL/TLS certificate</Label>
                <p className="text-xs text-muted-foreground">
                  Only send to https servers whose certificate checks out, so nobody in between can
                  read or change deliveries. Applies to https URLs only.
                </p>
              </div>
              <Switch
                id={`${idPrefix}-verify-tls`}
                checked={draft.value.tlsVerify}
                onCheckedChange={(v) => set({ tlsVerify: v })}
              />
            </div>
            {!draft.value.tlsVerify && (
              <p
                className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
                role="alert"
              >
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                Deliveries can be read or changed by anyone between GradeBook and your server. Use a
                trusted CA certificate instead if your server uses a self-signed certificate.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-ca-cert`}>Trusted CA certificate (optional)</Label>
              {existing && existing.tls.caFingerprints.length > 0 && !draft.value.clearCa && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Saved: {existing.tls.caFingerprints.length} certificate
                    {existing.tls.caFingerprints.length === 1 ? "" : "s"} (SHA-256{" "}
                    <code className="break-all">{existing.tls.caFingerprints[0]}</code>
                    {existing.tls.caFingerprints.length > 1 ? ", …" : ""}). Paste a new one to replace it.
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => set({ clearCa: true, tlsCaCert: "" })}>
                    Remove
                  </Button>
                </div>
              )}
              {draft.value.clearCa && (
                <p className="text-xs text-muted-foreground">
                  The saved CA certificate will be removed when you save.{" "}
                  <button type="button" className="underline" onClick={() => set({ clearCa: false })}>
                    Keep it
                  </button>
                </p>
              )}
              <Textarea
                id={`${idPrefix}-ca-cert`}
                value={draft.value.tlsCaCert}
                rows={4}
                maxLength={MAX_CA_BYTES}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
                onChange={(e) => set({ tlsCaCert: e.target.value, ...(e.target.value ? { clearCa: false } : {}) })}
              />
              <p className="text-xs text-muted-foreground">
                For a server on your network with a self-signed or private-CA certificate: paste the
                CA certificate (PEM, one or more). GradeBook then trusts that CA instead of the public
                ones for this webhook - verification stays on. Never paste a private key.
              </p>
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${idPrefix}-enabled`}>Send events</Label>
            <Switch
              id={`${idPrefix}-enabled`}
              checked={draft.value.enabled}
              onCheckedChange={(v) => set({ enabled: v })}
            />
          </div>

          {problem && draft.value.name && <p className="text-sm text-destructive">{problem}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!problem || saving.value || (!!existing && !patch)}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              {existing ? "Save" : "Add webhook"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
