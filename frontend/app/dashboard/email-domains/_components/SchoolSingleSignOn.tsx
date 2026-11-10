"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import type { EmailDomain } from "@/lib/email-domains";
import { ssoProvidersApi, usesEmailCodesOnly, type SchoolSsoProvider } from "@/lib/sign-in-providers";
import { EmailDomainsManager } from "./EmailDomainsManager";
import { SignInApps } from "./SignInApps";
import { SsoActivity } from "./SsoActivity";
import { userMessage } from "@/lib/errors";

export function SchoolSingleSignOn({ apiBase, schoolName }: { apiBase?: string; schoolName: string }) {
  useSignals();
  const providers = useSignal<SchoolSsoProvider[] | null>(null);
  const domains = useSignal<EmailDomain[] | null>(null);

  useEffect(() => {
    api<SchoolSsoProvider[]>(ssoProvidersApi(apiBase))
      .then((list) => (providers.value = Array.isArray(list) ? list : []))
      .catch((err) => {
        providers.value = [];
        toast.error(userMessage(err, "Failed to load sign-in apps"));
      });
  }, [apiBase, providers]);

  // Bumped after every change, so Activity shows it.
  const activityKey = useSignal(0);
  const domainsLoaded = useRef(false);

  const onSaved = useCallback((saved: SchoolSsoProvider) => {
    providers.value = providers.value?.map((p) => (p.key === saved.key ? saved : p)) ?? providers.value;
    activityKey.value = activityKey.value + 1;
  }, [activityKey, providers]);

  const onDomainsChange = useCallback((list: EmailDomain[]) => {
    domains.value = list;
    // The first call is the initial load, not a change.
    if (domainsLoaded.current) activityKey.value = activityKey.value + 1;
    domainsLoaded.current = true;
  }, [activityKey, domains]);

  const emailCodesOnly =
    providers.value !== null && domains.value !== null && usesEmailCodesOnly(providers.value, domains.value);

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
      <SignInApps providers={providers.value} apiBase={apiBase} onSavedAction={onSaved} />
      <EmailDomainsManager
        apiBase={apiBase}
        schoolName={schoolName}
        providers={providers.value}
        onDomainsChangeAction={onDomainsChange}
      />
      <SsoActivity apiBase={apiBase} refreshKey={activityKey.value} />
    </div>
  );
}
