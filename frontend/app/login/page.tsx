"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { SsoProviderIcon } from "@/components/auth/sso-provider-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useProfile } from "@/providers/AuthProvider";
import { homePathFor, NEXT_PARAM, safeNextPath } from "@/lib/routing";
import {
  isSsoRequiredMessage,
  ssoErrorMessage,
  ssoStartUrl,
  type SsoDiscovery,
  type SsoProvider,
} from "@/lib/sso";

/**
 * email: type an address. choice: the address's school offers single sign-on
 * but still allows codes. redirecting: on the way to the provider.
 */
type Step = "email" | "choice" | "redirecting";

function LoginEmailForm() {
  useSignals();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, loading: profileLoading } = useProfile();
  // Where a sign-in prompt was sent from (a scanned attendance QR, say);
  // only ever a same-origin path.
  const next = safeNextPath(searchParams?.get(NEXT_PARAM));
  // A failed single sign-on comes back here with a reason.
  const callbackError = ssoErrorMessage(searchParams?.get("error"));

  const email = useSignal("");
  const loading = useSignal(false);
  const step = useSignal<Step>("email");
  const schoolProvider = useSignal<SsoProvider | null>(null);
  const providers = useSignal<SsoProvider[]>([]);
  const needEmailFor = useSignal<SsoProvider | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Someone already signed in has no business on the sign-in form; send them
  // wherever their account type belongs.
  useEffect(() => {
    if (profileLoading.value) return;
    if (!profile.value) return;
    const home = homePathFor(profile.value);
    // Unfinished setup comes first; otherwise go back where they came from.
    const setupDone = home === "/portal" || home === "/dashboard";
    router.replace(setupDone && next ? next : home);
  }, [profileLoading.value, profile.value, router, next]);

  useEffect(() => {
    api<SsoProvider[]>("/auth/sso/providers", { skipAuthRedirect: true })
      .then((list) => (providers.value = Array.isArray(list) ? list : []))
      .catch(() => (providers.value = []));
  }, [providers]);

  // Coming back from the provider with the Back button restores this page
  // from the cache, still showing "Redirecting...".
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted && step.value === "redirecting") {
        step.value = schoolProvider.value ? "choice" : "email";
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [step, schoolProvider]);

  /** A usable address typed in, for providers that need or accept a hint. */
  function typedEmail(): string | null {
    const value = email.value.trim();
    if (!value) return null;
    return emailRef.current && !emailRef.current.checkValidity() ? null : value;
  }

  function goToProvider(provider: SsoProvider, address: string | null) {
    schoolProvider.value = schoolProvider.value ?? provider;
    step.value = "redirecting";
    window.location.assign(ssoStartUrl(provider.id, { email: address, next }));
  }

  /** Offer (or, when required, go straight to) the address's school provider. */
  function applyDiscovery(found: SsoDiscovery): boolean {
    if (!found.provider) return false;
    schoolProvider.value = found.provider;
    if (found.required) {
      goToProvider(found.provider, email.value.trim());
    } else {
      step.value = "choice";
    }
    return true;
  }

  async function discover(address: string): Promise<SsoDiscovery | null> {
    try {
      return await api<SsoDiscovery>(
        `/auth/sso/discover?${new URLSearchParams({ email: address }).toString()}`,
        { skipAuthRedirect: true },
      );
    } catch {
      // Discovery is a convenience; the code flow still refuses an address
      // whose school requires single sign-on, and that is handled below.
      return null;
    }
  }

  async function sendCode() {
    loading.value = true;
    try {
      await api("/auth/otp/send", {
        method: "POST",
        body: { email: email.value },
        skipAuthRedirect: true,
      });
      toast.success("OTP sent to your email");
      const params = new URLSearchParams({ email: email.value });
      if (next) params.set(NEXT_PARAM, next);
      router.push(`/login/verify?${params.toString()}`);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        isSsoRequiredMessage(err.message)
      ) {
        const found = await discover(email.value.trim());
        if (found?.provider) {
          applyDiscovery({ provider: found.provider, required: true });
          return;
        }
      }
      const message =
        err instanceof ApiError ? err.message : "Failed to send OTP";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    needEmailFor.value = null;
    loading.value = true;
    const found = await discover(email.value.trim());
    if (found && applyDiscovery(found)) {
      loading.value = false;
      return;
    }
    await sendCode();
  }

  function handleProviderButton(provider: SsoProvider) {
    const address = typedEmail();
    // SAML finds the school's identity provider by the address's domain.
    if (provider.kind === "saml" && !address) {
      needEmailFor.value = provider;
      emailRef.current?.focus();
      return;
    }
    needEmailFor.value = null;
    goToProvider(provider, address);
  }

  function backToEmail() {
    step.value = "email";
    schoolProvider.value = null;
  }

  const provider = schoolProvider.value;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign in to GradeBook</CardTitle>
        <CardDescription>
          {step.value === "choice" && provider
            ? `Your school signs in with ${provider.label}`
            : "Enter your email to sign in"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {callbackError && step.value !== "redirecting" && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{callbackError}</AlertDescription>
          </Alert>
        )}

        {step.value === "redirecting" && provider ? (
          <div
            className="flex flex-col items-center gap-3 py-6 text-center"
            role="status"
            aria-live="polite"
          >
            <Spinner className="size-6" />
            <p className="font-medium">Redirecting you to {provider.label}…</p>
            <p className="text-xs text-muted-foreground">
              Not moving?{" "}
              <a
                href={ssoStartUrl(provider.id, { email: email.value.trim(), next })}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Continue
              </a>
            </p>
          </div>
        ) : step.value === "choice" && provider ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              Signing in as{" "}
              <span className="font-medium text-foreground">{email.value}</span>
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={() => goToProvider(provider, email.value.trim())}
              disabled={loading.value}
            >
              <SsoProviderIcon provider={provider} />
              Continue with {provider.label}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={sendCode}
              disabled={loading.value}
            >
              {loading.value ? "Sending..." : "Email me a code instead"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={backToEmail}
              disabled={loading.value}
            >
              <ArrowLeft />
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  ref={emailRef}
                  id="email"
                  type="email"
                  placeholder="teacher@school.com"
                  value={email.value}
                  onChange={(e) => {
                    email.value = e.target.value;
                    needEmailFor.value = null;
                  }}
                  aria-describedby={needEmailFor.value ? "email-needed" : undefined}
                  required
                  autoFocus
                />
                {needEmailFor.value && (
                  <p id="email-needed" className="text-xs text-destructive">
                    Enter your school email first, then choose{" "}
                    {needEmailFor.value.label}.
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading.value}>
                {loading.value ? "Checking..." : "Continue"}
              </Button>
            </form>

            {providers.value.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  Or continue with
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2">
                  {providers.value.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => handleProviderButton(p)}
                      disabled={loading.value}
                    >
                      <SsoProviderIcon provider={p} />
                      {p.kind === "saml" ? "Your school (SSO)" : p.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-xs text-center text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <AuthPageShell>
      <Suspense>
        <LoginEmailForm />
      </Suspense>
    </AuthPageShell>
  );
}
