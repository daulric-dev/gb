"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { EmailDomain } from "@/lib/email-domains";
import {
  ssoProvidersApi,
  usesEmailCodesOnly,
  type SchoolSsoProvider,
} from "@/lib/sign-in-providers";
import { EmailDomainsManager } from "./EmailDomainsManager";
import { SignInApps } from "./SignInApps";

/**
 * One school's single sign-on, end to end: its own sign-in apps (Google,
 * Microsoft) and its email domains, each picking one of the providers the
 * school has available. Used on the school admin's Settings and Email
 * domains pages (the active school) and on a school's page in the
 * organisation console (`apiBase` = `organisationSchoolApi(id)`).
 */
export function SchoolSingleSignOn({
  apiBase,
  schoolName,
}: {
  /** Default: the active school. */
  apiBase?: string;
  schoolName: string;
}) {
  const [providers, setProviders] = useState<SchoolSsoProvider[] | null>(null);
  const [domains, setDomains] = useState<EmailDomain[] | null>(null);

  useEffect(() => {
    api<SchoolSsoProvider[]>(ssoProvidersApi(apiBase))
      .then((list) => setProviders(Array.isArray(list) ? list : []))
      .catch((err) => {
        setProviders([]);
        toast.error(err instanceof ApiError ? err.message : "Failed to load sign-in apps");
      });
  }, [apiBase]);

  const onSaved = useCallback(
    (saved: SchoolSsoProvider) =>
      setProviders((list) => list?.map((p) => (p.key === saved.key ? saved : p)) ?? list),
    [],
  );

  const emailCodesOnly =
    providers !== null && domains !== null && usesEmailCodesOnly(providers, domains);

  return (
    <div className="space-y-6">
      {emailCodesOnly && (
        <div className="flex gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <p>
            This school signs in with email codes. Set up SSO if it has Google
            Workspace, Microsoft or a SAML provider.
          </p>
        </div>
      )}
      <SignInApps providers={providers} apiBase={apiBase} onSavedAction={onSaved} />
      <EmailDomainsManager
        apiBase={apiBase}
        schoolName={schoolName}
        providers={providers}
        onDomainsChangeAction={setDomains}
      />
    </div>
  );
}
