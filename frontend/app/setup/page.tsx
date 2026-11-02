"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { Building2, Loader2, LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { homePathFor, ORGANISATION_SCHOOLS_WELCOME_PATH } from "@/lib/routing";
import { resetSetupStatus, setupEligibility } from "@/lib/setup";
import { useAuth } from "@/providers/AuthProvider";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/errors";

/**
 * First-run setup: a signed-in user names the organisation that runs this
 * install and becomes its first administrator. The API decides who may do
 * it; anyone else sees why and waits (there is no way round it).
 */
export default function SetupPage() {
  useSignals();
  const router = useRouter();
  const { profile, loading, refresh } = useAuth();
  const [checking, setChecking] = useState(true);
  /** Setup is pending but this user may not run it. */
  const [waiting, setWaiting] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);

  const signedIn = !loading.value && !!profile.value;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void setupEligibility().then(({ needsSetup, canSetUp }) => {
      if (cancelled) return;
      if (!needsSetup) router.replace(homePathFor(profile.value));
      else {
        setWaiting(!canSetUp);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, profile.value, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const organisationName = name.trim();
    if (!organisationName) return;
    setSaving(true);
    setError(null);
    try {
      await api("/setup", { method: "POST", body: { organisationName } });
      resetSetupStatus(true);
      await refresh();
      // Straight on to the school manager: an organisation is its schools.
      router.replace(ORGANISATION_SCHOOLS_WELCOME_PATH);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setWaiting(true);
        setError({
          message: userMessage(err, "You are not allowed to set up this install."),
          forbidden: true,
        });
      } else if (err instanceof ApiError && err.status === 409) {
        // Someone else finished setup meanwhile.
        resetSetupStatus(true);
        await refresh();
        router.replace(homePathFor(profile.value));
      } else {
        setError({
          message: userMessage(err, "Setup failed. Try again."),
          forbidden: false,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    router.push("/login");
  }

  return (
    <AuthPageShell>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Building2 className="mx-auto size-10 text-primary" />
          <CardTitle className="text-2xl">Set up GradeBook</CardTitle>
          <CardDescription>
            Name the organisation that runs this install - a school district,
            trust or single school. You&apos;ll become its first administrator
            and can add schools next.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!signedIn || checking ? (
            <div className="space-y-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : waiting ? (
            <div
              role="status"
              className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm"
            >
              <p className="font-medium">GradeBook isn&apos;t set up yet</p>
              <p className="text-muted-foreground">
                {error?.message ??
                  "Only a school administrator on this server, or an email listed in ORG_ADMIN_EMAILS, can finish setting up GradeBook. Sign in as one, or ask whoever runs this server."}
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organisation-name">Organisation name</Label>
                <Input
                  id="organisation-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Northside Schools Trust"
                  required
                  autoFocus
                />
              </div>
              {error && (
                <div
                  role="alert"
                  className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
                >
                  <p>{error.message}</p>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={saving || !name.trim()}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create organisation
              </Button>
            </form>
          )}
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 size-3.5" />
              Log out
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
