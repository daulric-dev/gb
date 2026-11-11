"use client";

import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { ArrowDown, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import {
  clientIdHint,
  draftOf,
  providerStatus,
  providerUpdate,
  samlApp,
  secretStatus,
  selectDraft,
  selectValue,
  signInApps,
  ssoProvidersApi,
  switchOn,
  type ProviderDraft,
  type SchoolSsoProvider,
  type SignInSettingField,
} from "@/lib/sign-in-providers";
import { samlServiceProvider } from "@/lib/sso";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyRow } from "./CopyRow";
import { userMessage } from "@/lib/errors";

/**
 * One school's own sign-in apps: a row each for Google, Microsoft and a
 * custom OpenID Connect provider with an on/off switch, the provider's
 * settings, the OAuth client ID, a write-only client secret (stored
 * encrypted, never shown again) and the redirect URI to register. Until the
 * school saves its own, Google and Microsoft use the server's app when the
 * install has one. A last, read-only row explains SAML 2.0, which is set up
 * on each email domain (`domainsId` is that section's element id).
 */
export function SignInApps({
  providers,
  apiBase,
  domainsId,
  onSavedAction,
}: {
  /** The school's providers; null while loading. */
  providers: SchoolSsoProvider[] | null;
  /** See `ssoProvidersApi`; default: the active school. */
  apiBase?: string;
  /** The email domains section's id, for the SAML row's link. */
  domainsId?: string;
  onSavedAction: (p: SchoolSsoProvider) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-medium">Sign-in apps</h3>
        <p className="text-sm text-muted-foreground">
          Google, Microsoft, any OpenID Connect provider, or SAML 2.0 (set per
          email domain). Register an app with the redirect URI shown, then
          paste its client ID and secret.
        </p>
      </div>
      <div className="divide-y rounded-lg border px-4">
        {!providers ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="my-3 h-8" />)
        ) : (
          <>
            {signInApps(providers).map((p) => (
              <ProviderRow
                key={`${p.key}:${p.updatedAt ?? ""}:${p.configSource}`}
                provider={p}
                apiBase={apiBase}
                onSaved={onSavedAction}
              />
            ))}
            <SamlRow provider={samlApp(providers)} domainsId={domainsId} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * SAML 2.0 has no app to save: each email domain connects its own identity
 * provider. Shows that, a way to the domains, and our metadata URL.
 */
function SamlRow({
  provider,
  domainsId,
}: {
  provider: SchoolSsoProvider | null;
  domainsId?: string;
}) {
  const metadataUrl = provider?.saml?.metadataUrl ?? samlServiceProvider().metadataUrl;
  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <span className="font-medium">{provider?.label ?? "SAML 2.0"}</span>
        <Badge variant="outline">Per email domain</Badge>
      </div>
      <div className="space-y-3 pl-6">
        <p className="text-xs text-muted-foreground">
          No app needed - set up per email domain (Okta, ADFS, ClassLink,
          Shibboleth, Keycloak, your own IdP).
          {domainsId && (
            <>
              {" "}
              <button
                type="button"
                className="inline-flex items-center gap-0.5 underline underline-offset-4 hover:text-foreground"
                onClick={() =>
                  document
                    .getElementById(domainsId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                Go to email domains
                <ArrowDown className="size-3" />
              </button>
            </>
          )}
        </p>
        <CopyRow
          label="Service provider metadata URL"
          value={metadataUrl}
          note="Give this to your identity provider, then pick SAML on the domain and paste the identity provider's details there."
        />
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

          {p.settingFields.map((f) => (
            <SettingField
              key={f.key}
              id={`${id}-${f.key}`}
              field={f}
              value={draft.value.settings[f.key] ?? ""}
              onChange={(v) => set({ settings: { ...draft.value.settings, [f.key]: v } })}
            />
          ))}

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

          {p.enabled && !draft.value.enabled && (
            <p className="text-xs text-muted-foreground">
              Domains that require {p.label} fall back to email codes while it is off.
            </p>
          )}
          {p.kind === "oauth" && p.configSource === "school" && p.available && (
            <p className="text-xs text-muted-foreground">
              To try it, pick {p.label} on one of your email domains below and
              use its Test sign-in link.
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

/** One of a provider's settings, drawn by its type. */
function SettingField({
  id,
  field: f,
  value,
  onChange,
}: {
  id: string;
  field: SignInSettingField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (f.type === "switch") {
    const on = switchOn(value);
    return (
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor={id}>{f.label}</Label>
            <p className="text-xs text-muted-foreground">{f.description}</p>
          </div>
          <Switch id={id} checked={on} onCheckedChange={(v) => onChange(v ? "true" : "")} />
        </div>
        {on && f.warning && (
          <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {f.warning}
          </p>
        )}
      </div>
    );
  }

  if (f.type === "select" && f.options?.length) {
    const items = f.options.map((o) => ({ value: o.value, label: o.label }));
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{f.label}</Label>
        <Select
          value={selectValue(f, value)}
          onValueChange={(v) => onChange(selectDraft(f, (v as string | null) ?? ""))}
          items={items}
        >
          <SelectTrigger id={id} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{f.description}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{f.label}</Label>
      <Input
        id={id}
        className={f.type === "url" ? "font-mono" : undefined}
        type={f.type === "url" ? "url" : "text"}
        inputMode={f.type === "url" ? "url" : undefined}
        value={value}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">{f.description}</p>
    </div>
  );
}
