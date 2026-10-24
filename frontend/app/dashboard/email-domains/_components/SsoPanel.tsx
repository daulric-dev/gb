"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { KeyRound, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { EmailDomain } from "@/lib/email-domains";
import {
  isHttpsUrl,
  looksLikeCertificate,
  samlServiceProvider,
  ssoProviderName,
  type SsoProvider,
} from "@/lib/sso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CopyRow } from "./CopyRow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Select value standing for "no provider" (Base UI items need a string). */
const NONE = "none";

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single sign-on settings for one domain. Mount it keyed on the domain's SSO
 * fields so a save (or another change) resets the form to what is stored.
 */
export function SsoPanel({
  domain,
  providers,
  onSavedAction,
}: {
  domain: EmailDomain;
  /** null while loading. */
  providers: SsoProvider[] | null;
  onSavedAction: (domain: EmailDomain) => void;
}) {
  useSignals();

  const provider = useSignal(domain.ssoProvider ?? NONE);
  const tenant = useSignal(domain.azureTenantId ?? "");
  const required = useSignal(domain.ssoRequired);
  const samlEntryPoint = useSignal(domain.samlEntryPoint ?? "");
  const samlIssuer = useSignal(domain.samlIssuer ?? "");
  const samlCertificate = useSignal(domain.samlCertificate ?? "");
  const saving = useSignal(false);

  if (!domain.verified) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          Verify the domain to set up sign-in.
        </p>
      </Section>
    );
  }

  if (providers === null) {
    return (
      <Section>
        <Skeleton className="h-8 w-full" />
      </Section>
    );
  }

  if (providers.length === 0) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          No sign-in providers are set up on this server - see the SSO guide
          (Single Sign-On in the developer docs).
          {domain.ssoProvider && (
            <>
              {" "}
              This domain is set to <span className="font-mono">{domain.ssoProvider}</span>,
              which is not available, so email codes are used.
            </>
          )}
        </p>
      </Section>
    );
  }

  const items = [
    { value: NONE, label: "None - email codes" },
    ...providers.map((p) => ({ value: p.id, label: ssoProviderName(p, p.id) })),
  ];
  // Stored but switched off on the server since: keep it visible.
  if (domain.ssoProvider && !providers.some((p) => p.id === domain.ssoProvider)) {
    items.push({
      value: domain.ssoProvider,
      label: `${ssoProviderName(undefined, domain.ssoProvider)} (not available)`,
    });
  }

  const chosen = provider.value === NONE ? null : provider.value;
  const isAzure = chosen === "azure";
  const tenantValue = tenant.value.trim();
  const tenantInvalid = isAzure && tenantValue !== "" && !TENANT_ID.test(tenantValue);
  const isSaml = chosen === "saml";
  const entryPointValue = samlEntryPoint.value.trim();
  const issuerValue = samlIssuer.value.trim();
  const certificateValue = samlCertificate.value.trim();
  const entryPointInvalid = isSaml && entryPointValue !== "" && !isHttpsUrl(entryPointValue);
  const certificateInvalid =
    isSaml && certificateValue !== "" && !looksLikeCertificate(certificateValue);
  // The API only accepts provider "saml" once all three are set.
  const samlIncomplete =
    isSaml &&
    (!entryPointValue || !issuerValue || !certificateValue || entryPointInvalid || certificateInvalid);
  const canRequire =
    !!chosen && (!isAzure || (tenantValue !== "" && !tenantInvalid)) && !samlIncomplete;
  const ids = `sso-${domain.id}`;

  const dirty =
    chosen !== domain.ssoProvider ||
    (tenantValue || null) !== (domain.azureTenantId ?? null) ||
    required.value !== domain.ssoRequired ||
    (isSaml &&
      (entryPointValue !== (domain.samlEntryPoint ?? "") ||
        issuerValue !== (domain.samlIssuer ?? "") ||
        certificateValue !== (domain.samlCertificate?.trim() ?? "")));

  async function save() {
    saving.value = true;
    try {
      const saved = await api<EmailDomain>(`/schools/email-domains/${domain.id}`, {
        method: "PATCH",
        body: {
          ssoProvider: chosen,
          azureTenantId: tenantValue || null,
          ssoRequired: chosen ? required.value : false,
          // Sent only with SAML chosen, so switching provider keeps them.
          ...(isSaml && {
            samlEntryPoint: entryPointValue,
            samlIssuer: issuerValue,
            samlCertificate: certificateValue,
          }),
        },
      });
      toast.success(`Sign-in settings saved for ${domain.domain}`);
      onSavedAction(saved);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save sign-in settings",
      );
    } finally {
      saving.value = false;
    }
  }

  return (
    <Section>
      <div className="space-y-2">
        <Label htmlFor={`${ids}-provider`}>Sign-in provider</Label>
        <Select
          value={provider.value}
          onValueChange={(v) => {
            provider.value = (v as string | null) ?? NONE;
            if (provider.value === NONE) required.value = false;
          }}
          items={items}
        >
          <SelectTrigger id={`${ids}-provider`} className="w-full sm:w-72">
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
        <p className="text-xs text-muted-foreground">
          People at @{domain.domain} can sign in with their school account
          instead of an emailed code.
        </p>
      </div>

      {isAzure && (
        <div className="space-y-2">
          <Label htmlFor={`${ids}-tenant`}>Microsoft tenant ID</Label>
          <Input
            id={`${ids}-tenant`}
            className="font-mono sm:w-96"
            placeholder="72f988bf-86f1-41af-91ab-2d7cd011db47"
            value={tenant.value}
            onChange={(e) => (tenant.value = e.target.value)}
            aria-invalid={tenantInvalid || undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <p
            className={
              tenantInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {tenantInvalid
              ? "A tenant ID is a GUID like 72f988bf-86f1-41af-91ab-2d7cd011db47."
              : "Find it in the Azure portal under Microsoft Entra ID > Overview > Tenant ID. Only sign-ins from this tenant join your school."}
          </p>
        </div>
      )}

      {isSaml && (
        <SamlFields
          ids={ids}
          entryPoint={samlEntryPoint.value}
          issuer={samlIssuer.value}
          certificate={samlCertificate.value}
          entryPointInvalid={entryPointInvalid}
          certificateInvalid={certificateInvalid}
          onEntryPoint={(v) => (samlEntryPoint.value = v)}
          onIssuer={(v) => (samlIssuer.value = v)}
          onCertificate={(v) => (samlCertificate.value = v)}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={`${ids}-required`}>Require single sign-on</Label>
          <p className="text-xs text-muted-foreground">
            Email codes stop working for @{domain.domain}; when an account is
            disabled at the school, access here ends too.
            {!chosen && " Choose a provider first."}
            {chosen && isAzure && !canRequire && " Add the tenant ID first."}
            {isSaml && samlIncomplete && " Fill in the identity provider details first."}
          </p>
        </div>
        <Switch
          id={`${ids}-required`}
          checked={required.value}
          onCheckedChange={(v) => (required.value = v)}
          disabled={!canRequire && !required.value}
        />
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || saving.value || tenantInvalid || samlIncomplete}
        >
          {saving.value && <Loader2 className="mr-1.5 size-4 animate-spin" />}
          Save sign-in settings
        </Button>
      </div>
    </Section>
  );
}

/** The school's IdP details, and what to register with the IdP in return. */
function SamlFields({
  ids,
  entryPoint,
  issuer,
  certificate,
  entryPointInvalid,
  certificateInvalid,
  onEntryPoint,
  onIssuer,
  onCertificate,
}: {
  ids: string;
  entryPoint: string;
  issuer: string;
  certificate: string;
  entryPointInvalid: boolean;
  certificateInvalid: boolean;
  onEntryPoint: (value: string) => void;
  onIssuer: (value: string) => void;
  onCertificate: (value: string) => void;
}) {
  const sp = samlServiceProvider();
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Give your identity provider these</p>
          <p className="text-xs text-muted-foreground">
            Most identity providers can read everything from the metadata URL.
            Otherwise enter the ACS URL and entity ID by hand, and have it send
            the user&apos;s email address as the NameID or an email attribute.
          </p>
        </div>
        <CopyRow label="Metadata URL" value={sp.metadataUrl} />
        <CopyRow label="ACS (reply) URL" value={sp.acsUrl} />
        <CopyRow label="Entity ID (audience)" value={sp.entityId} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-saml-entry`}>Identity provider sign-on URL</Label>
        <Input
          id={`${ids}-saml-entry`}
          className="font-mono"
          type="url"
          inputMode="url"
          placeholder="https://idp.example.edu/sso/saml"
          value={entryPoint}
          onChange={(e) => onEntryPoint(e.target.value)}
          aria-invalid={entryPointInvalid || undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <p
          className={
            entryPointInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {entryPointInvalid
            ? "Use the full https:// address."
            : "The SAML single sign-on (SSO) URL, also called the login or redirect URL."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-saml-issuer`}>Identity provider entity ID</Label>
        <Input
          id={`${ids}-saml-issuer`}
          className="font-mono"
          placeholder="https://idp.example.edu/saml/metadata"
          value={issuer}
          onChange={(e) => onIssuer(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Also called the issuer. Sign-ins from any other issuer are refused.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-saml-cert`}>Identity provider signing certificate</Label>
        <Textarea
          id={`${ids}-saml-cert`}
          className="min-h-28 font-mono text-xs"
          placeholder={"-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----"}
          value={certificate}
          onChange={(e) => onCertificate(e.target.value)}
          aria-invalid={certificateInvalid || undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <p
          className={
            certificateInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {certificateInvalid
            ? "Paste the whole certificate, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----."
            : "The X.509 certificate the identity provider signs with (PEM). Not a private key."}
        </p>
      </div>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="size-4 text-muted-foreground" />
        Single sign-on
      </p>
      {children}
    </div>
  );
}
