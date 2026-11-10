"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  clientIdHint,
  draftOf,
  providerStatus,
  providerUpdate,
  secretStatus,
  signInApps,
  ssoProvidersApi,
  type ProviderDraft,
  type SchoolSsoProvider,
} from "@/lib/sign-in-providers";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CopyRow } from "./CopyRow";
import { userMessage } from "@/lib/errors";

/**
 * One school's own sign-in apps: a row each for Google and Microsoft with an
 * on/off switch, the OAuth client ID, a write-only client secret (stored
 * encrypted, never shown again) and the redirect URI to register. Until the
 * school saves its own, a provider uses the server's app when the install
 * has one.
 */
export function SignInApps({
  providers,
  apiBase,
  onSavedAction,
}: {
  /** The school's providers; null while loading. */
  providers: SchoolSsoProvider[] | null;
  /** See `ssoProvidersApi`; default: the active school. */
  apiBase?: string;
  onSavedAction: (p: SchoolSsoProvider) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-medium">Sign-in apps</h3>
        <p className="text-sm text-muted-foreground">
          Your school&apos;s own Google Workspace or Microsoft app. Register it
          with the redirect URI shown, then paste its client ID and secret.
        </p>
      </div>
      <div className="divide-y rounded-lg border px-4">
        {!providers
          ? [1, 2].map((i) => <Skeleton key={i} className="my-3 h-8" />)
          : signInApps(providers).map((p) => (
              <ProviderRow
                key={`${p.key}:${p.updatedAt ?? ""}:${p.configSource}`}
                provider={p}
                apiBase={apiBase}
                onSaved={onSavedAction}
              />
            ))}
      </div>
    </div>
  );
}

function ProviderRow({
  provider: p,
  apiBase,
  onSaved,
}: {
  provider: SchoolSsoProvider;
  apiBase?: string;
  onSaved: (p: SchoolSsoProvider) => void;
}) {
  useSignals();
  const open = useSignal(false);
  const draft = useSignal<ProviderDraft>(draftOf(p));
  const saving = useSignal(false);
  const body = providerUpdate(p, draft.value);
  const status = providerStatus(p);
  const id = `sign-in-app-${p.key}${apiBase ? `-${apiBase.replace(/\W+/g, "-")}` : ""}`;
  const set = (patch: Partial<ProviderDraft>) => (draft.value = { ...draft.value, ...patch });

  async function save() {
    if (!body) return;
    saving.value = true;
    try {
      const saved = await api<SchoolSsoProvider>(
        `${ssoProvidersApi(apiBase)}/${encodeURIComponent(p.key)}`,
        { method: "PUT", body, stepUp: true },
      );
      toast.success(`${saved.label} saved`);
      onSaved(saved);
    } catch (err) {
      toast.error(userMessage(err, `Failed to save ${p.label}`));
    } finally {
      saving.value = false;
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => (open.value = !open.value)}
          aria-expanded={open.value}
          aria-controls={`${id}-body`}
        >
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open.value && "-rotate-90")}
          />
          <span className="truncate font-medium">{p.label}</span>
          <Badge
            variant={status.tone === "off" ? "outline" : "secondary"}
            className={
              status.tone === "ok"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : status.tone === "warn"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : undefined
            }
          >
            {status.label}
          </Badge>
        </button>
        <Switch
          id={`${id}-enabled`}
          checked={draft.value.enabled}
          onCheckedChange={(v) => {
            set({ enabled: v });
            open.value = true;
          }}
          aria-label={`Turn ${p.label} on`}
        />
      </div>

      {open.value && (
        <div id={`${id}-body`} className="mt-3 space-y-4 pl-6">
          {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
          {p.redirectUri && (
            <CopyRow
              label="Redirect URI"
              value={p.redirectUri}
              note="Register this at the provider exactly as shown."
            />
          )}

          {p.needsClient && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-client-id`}>Client ID</Label>
                <Input
                  id={`${id}-client-id`}
                  value={draft.value.clientId}
                  placeholder={p.configSource === "env" ? (p.clientId ?? "") : ""}
                  onChange={(e) => set({ clientId: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                {clientIdHint(p) && (
                  <p className="text-xs text-muted-foreground">{clientIdHint(p)}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-client-secret`}>Client secret</Label>
                <Input
                  id={`${id}-client-secret`}
                  type="password"
                  value={draft.value.clientSecret}
                  placeholder={
                    draft.value.clearSecret
                      ? "Will be cleared"
                      : p.hasSecret
                        ? "•••••••• (type to replace)"
                        : "Paste the client secret"
                  }
                  onChange={(e) => set({ clientSecret: e.target.value, clearSecret: false })}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{secretStatus(p)}</span>
                  {p.secretSource === "school" && !draft.value.clientSecret && (
                    <button
                      type="button"
                      className="underline underline-offset-4 hover:text-foreground"
                      onClick={() => set({ clearSecret: !draft.value.clearSecret })}
                    >
                      {draft.value.clearSecret ? "Keep it" : "Clear saved secret"}
                    </button>
                  )}
                </p>
              </div>
            </div>
          )}

          {p.settingFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`${id}-${f.key}`}>{f.label}</Label>
              <Input
                id={`${id}-${f.key}`}
                value={draft.value.settings[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  set({ settings: { ...draft.value.settings, [f.key]: e.target.value } })
                }
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{f.description}</p>
            </div>
          ))}

          {p.enabled && !draft.value.enabled && (
            <p className="text-xs text-muted-foreground">
              Domains that require {p.label} fall back to email codes while it is off.
            </p>
          )}
          {p.configSource === "env" && p.available && (
            <p className="text-xs text-muted-foreground">
              Saving here gives your school its own {p.label} settings in
              place of the server&apos;s app.
            </p>
          )}

          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!body || saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
