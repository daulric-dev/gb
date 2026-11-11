"use client";

import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { emailDomainsApi, type EmailDomain } from "@/lib/email-domains";
import {
  isHttpsUrl,
  looksLikeCertificate,
  samlServiceProvider,
  ssoProviderName,
  ssoStartUrl,
  type SsoProvider,
} from "@/lib/sso";
import { unavailableApps, type SchoolSsoProvider } from "@/lib/sign-in-providers";
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
import { userMessage } from "@/lib/errors";

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
  catalog,
  apiBase,
  onSavedAction,
}: {
  domain: EmailDomain;
  /** The providers available to this school; null while loading. */
  providers: SsoProvider[] | null;
  /** The school's providers with their status (SAML service provider details too). */
  catalog: SchoolSsoProvider[] | null;
  /** See `emailDomainsApi`; default: the active school. */
  apiBase?: string;
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
          No sign-in provider is set up for this school yet. Add your
          Google, Microsoft or OpenID Connect app under Sign-in apps above.
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
  // Stored but no longer available to the school: keep it visible.
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
      const saved = await api<EmailDomain>(`${emailDomainsApi(apiBase)}/${domain.id}`, {
        method: "PATCH",
        stepUp: true,
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
      toast.error(userMessage(err, "Failed to save sign-in settings"));
    } finally {
      saving.value = false;
    }
  }

  const missing = catalog ? unavailableApps(catalog) : [];
  const sp = catalog?.find((p) => p.saml)?.saml ?? samlServiceProvider();
  // Test only what is saved and offered right now.
  const testable =
    !dirty &&
    !!domain.ssoProvider &&
    providers.some((p) => p.id === domain.ssoProvider);

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
        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not set up for this school: {missing.map((p) => p.label).join(", ")}.
            Add it under Sign-in apps above to use it here.
          </p>
        )}
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
          sp={sp}
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

      {testable && (
        <TestSignIn ids={ids} providerId={domain.ssoProvider!} domain={domain.domain} />
      )}

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
/**
 * A start link for the saved provider with an address on the domain (it
 * picks the Microsoft tenant or SAML connection). Opening it signs that
 * browser in as the test account, so the hint says to use a private window.
 */
function TestSignIn({
  ids,
  providerId,
  domain,
}: {
  ids: string;
  providerId: string;
  domain: string;
}) {
  useSignals();
  const email = useSignal("");
  const value = email.value.trim().toLowerCase();
  const valid = value.endsWith(`@${domain}`) && value.length > domain.length + 1;
  const url = valid ? ssoStartUrl(providerId, { email: value }) : null;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <Label htmlFor={`${ids}-test`}>Test sign-in</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${ids}-test`}
          className="sm:w-72"
          type="email"
          placeholder={`someone@${domain}`}
          value={email.value}
          onChange={(e) => (email.value = e.target.value)}
          autoComplete="off"
        />
        {url ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={url} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLink className="mr-1.5 size-4" />
            Open
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            <ExternalLink className="mr-1.5 size-4" />
            Open
          </Button>
        )}
      </div>
      {url && <CopyRow label="Sign-in link" value={url} />}
      <p className="text-xs text-muted-foreground">
        Finishing the sign-in signs that browser in as the test account - copy
        the link into a private window to stay signed in here.
      </p>
    </div>
  );
}

function SamlFields({
  ids,
  sp,
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
  sp: { metadataUrl: string; acsUrl: string; entityId: string };
  entryPoint: string;
  issuer: string;
  certificate: string;
  entryPointInvalid: boolean;
  certificateInvalid: boolean;
  onEntryPoint: (value: string) => void;
  onIssuer: (value: string) => void;
  onCertificate: (value: string) => void;
}) {
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
