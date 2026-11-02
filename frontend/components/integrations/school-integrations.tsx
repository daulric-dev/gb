"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import {
  EVENT_TYPES_PATH,
  eventsSummary,
  SUBSCRIBABLE,
  webhooksApi,
  type EventTypeCatalog,
  type Webhook,
  type WebhookDeliveryDetail,
  type WebhookWithSecret,
} from "@/lib/webhooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { SecretOnceDialog } from "./secret-once-dialog";
import { WebhookDeliveries } from "./webhook-deliveries";
import { IntegrationActivity } from "./integration-activity";
import { DeliveryStatusBadge, when } from "./status-badge";

/**
 * One school's integrations: its webhooks (several allowed, each with its
 * own URL and events), add / edit / delete, Test, rotate secret, deliveries
 * and the activity log. The active school's by default; the organisation
 * console passes `apiBase`. Config changes ask "Confirm it's you" (step-up).
 * While the `integrations` feature is off the API answers FEATURE_DISABLED
 * and this shows `disabledHint` (or nothing).
 */
export function SchoolIntegrations({
  apiBase,
  disabledHint,
}: {
  apiBase?: string;
  disabledHint?: React.ReactNode;
}) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [catalog, setCatalog] = useState<EventTypeCatalog | null>(null);
  const [off, setOff] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [secret, setSecret] = useState<{ value: string; name: string; rotated: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    api<Webhook[]>(webhooksApi(apiBase))
      .then((list) => live && (setHooks(list), setOff(false)))
      .catch((err) => {
        if (!live) return;
        if (isFeatureDisabledError(err)) setOff(true);
        else toast.error(err instanceof ApiError ? err.message : "Failed to load webhooks");
        setHooks([]);
      });
    return () => {
      live = false;
    };
  }, [apiBase, refresh]);

  useEffect(() => {
    api<EventTypeCatalog>(EVENT_TYPES_PATH)
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  if (off) return disabledHint ? <>{disabledHint}</> : null;

  const total = catalog?.eventTypes.filter(SUBSCRIBABLE).length ?? 0;

  function created(r: WebhookWithSecret) {
    setSecret({ value: r.secret, name: r.webhook.name, rotated: false });
    bump();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium">Webhooks</h3>
            <p className="text-sm text-muted-foreground">
              Each webhook receives the events you choose. Add more than one to
              send different events to different systems. Receivers must check
              the signature and skip event ids they have already handled.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormKey((k) => k + 1);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-1.5 size-4" />
            Add webhook
          </Button>
        </div>

        {hooks === null ? (
          <Skeleton className="h-20 w-full" />
        ) : hooks.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <WebhookIcon className="size-4 shrink-0" />
            No webhooks yet.
          </div>
        ) : (
          <div className="divide-y rounded-lg border px-4">
            {hooks.map((h) => (
              <WebhookRow
                key={h.id}
                hook={h}
                apiBase={apiBase}
                catalog={catalog}
                total={total}
                refreshKey={refresh}
                onEditAction={() => {
                  setEditing(h);
                  setFormKey((k) => k + 1);
                  setFormOpen(true);
                }}
                onRotatedAction={(r) => {
                  setSecret({ value: r.secret, name: r.webhook.name, rotated: true });
                  bump();
                }}
                onChangedAction={bump}
              />
            ))}
          </div>
        )}
      </div>

      <IntegrationActivity apiBase={apiBase} refreshKey={refresh} />

      <WebhookFormDialog
        key={formKey}
        open={formOpen}
        existing={editing}
        apiBase={apiBase}
        catalog={catalog}
        onOpenChangeAction={setFormOpen}
        onCreatedAction={created}
        onSavedAction={bump}
      />
      <SecretOnceDialog
        secret={secret?.value ?? null}
        webhookName={secret?.name ?? ""}
        rotated={!!secret?.rotated}
        onCloseAction={() => setSecret(null)}
      />
    </div>
  );
}

function WebhookRow({
  hook: h,
  apiBase,
  catalog,
  total,
  refreshKey,
  onEditAction,
  onRotatedAction,
  onChangedAction,
}: {
  hook: Webhook;
  apiBase?: string;
  catalog: EventTypeCatalog | null;
  total: number;
  refreshKey: number;
  onEditAction: () => void;
  onRotatedAction: (r: WebhookWithSecret) => void;
  onChangedAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `${webhooksApi(apiBase)}/${h.id}`;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${label}`);
    } finally {
      setBusy(null);
    }
  }

  const toggle = (enabled: boolean) =>
    run(enabled ? "turn it on" : "turn it off", async () => {
      await api(base, { method: "PATCH", body: { enabled }, stepUp: true });
      toast.success(enabled ? "Webhook turned on" : "Webhook turned off");
      onChangedAction();
    });

  const test = () =>
    run("send a test", async () => {
      const d = await api<WebhookDeliveryDetail>(`${base}/test`, { method: "POST" });
      if (d.status === "succeeded") toast.success(`Test delivered (HTTP ${d.lastStatusCode})`);
      else toast.error(`Test failed: ${d.lastError ?? "no 2xx response"}`);
      setOpen(true);
      onChangedAction();
    });

  const rotate = () => {
    if (!window.confirm(`Rotate the signing secret for "${h.name}"? The current secret stops working immediately.`)) return;
    void run("rotate the secret", async () => {
      onRotatedAction(await api<WebhookWithSecret>(`${base}/rotate-secret`, { method: "POST", stepUp: true }));
    });
  };

  const remove = () => {
    if (!window.confirm(`Delete "${h.name}"? Its delivery history goes with it.`)) return;
    void run("delete it", async () => {
      await api(base, { method: "DELETE", stepUp: true });
      toast.success("Webhook deleted");
      onChangedAction();
    });
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{h.name}</span>
              <Badge variant="outline">{eventsSummary(h.events, total)}</Badge>
              {!h.enabled && <Badge variant="outline">Off</Badge>}
              {h.lastDelivery && <DeliveryStatusBadge status={h.lastDelivery.status} />}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{h.url}</span>
            {h.lastDelivery && (
              <span className="block text-xs text-muted-foreground">
                Last: {h.lastDelivery.eventType} · {when(h.lastDelivery.createdAt)}
              </span>
            )}
          </span>
        </button>
        <Switch
          checked={h.enabled}
          disabled={!!busy}
          onCheckedChange={(v) => void toggle(v)}
          aria-label={`Send events to ${h.name}`}
        />
      </div>

      {h.disabledReason && !h.enabled && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {h.disabledReason}. Fix the receiver, then turn it back on.
        </p>
      )}
      {h.secretUnreadable && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          The signing secret can no longer be read (the server&apos;s AUTH_SECRET changed). Rotate it.
        </p>
      )}
      {h.insecure && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Plain http: payloads travel unencrypted.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-4 pl-6">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEditAction}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={test} disabled={!!busy}>
              {busy === "send a test" ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Send className="mr-1.5 size-3.5" />}
              Test
            </Button>
            <Button size="sm" variant="outline" onClick={rotate} disabled={!!busy}>
              <KeyRound className="mr-1.5 size-3.5" />
              Rotate secret
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={remove} disabled={!!busy}>
              <Trash2 className="mr-1.5 size-3.5" />
              Delete
            </Button>
          </div>
          <WebhookDeliveries
            apiBase={apiBase}
            webhookId={h.id}
            catalog={catalog}
            refreshKey={refreshKey}
            onChangedAction={onChangedAction}
          />
        </div>
      )}
    </div>
  );
}
