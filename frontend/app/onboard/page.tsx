"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { useAuth, type UserProfile } from "@/providers/AuthProvider";
import { homePathFor } from "@/lib/routing";
import type { SsoSuggestedProfile } from "@/lib/sso";
import { cn } from "@/lib/utils";
import { GraduationCap, Briefcase } from "lucide-react";

type AccountType = "staff" | "student";

const OPTIONS: {
  value: AccountType;
  title: string;
  description: string;
  icon: typeof GraduationCap;
}[] = [
  {
    value: "staff",
    title: "Staff or faculty",
    description: "Teacher, administrator or other school staff",
    icon: Briefcase,
  },
  {
    value: "student",
    title: "Student",
    description: "Join your school and see your own grades",
    icon: GraduationCap,
  },
];

export default function OnboardPage() {
  useSignals();

  const router = useRouter();
  const { profile, refresh } = useAuth();
  const firstName = useSignal("");
  const lastName = useSignal("");
  // No default: a student who signs in with the school's shared domain must
  // not slip into staff by pressing Continue.
  const accountType = useSignal<AccountType | null>(null);
  const loading = useSignal(false);
  // Signed in through the school's provider, which already knows their name.
  const fromSso = useSignal(false);

  useEffect(() => {
    let cancelled = false;
    api<{ profile: SsoSuggestedProfile | null }>("/auth/sso/suggested-profile", {
      skipAuthRedirect: true,
    })
      .then((res) => {
        const suggested = res?.profile;
        if (cancelled || !suggested) return;
        fromSso.value = true;
        if (!firstName.value && suggested.firstName) {
          firstName.value = suggested.firstName;
        }
        if (!lastName.value && suggested.lastName) {
          lastName.value = suggested.lastName;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firstName, lastName, fromSso]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountType.value) {
      toast.error("Choose whether you're a student or staff");
      return;
    }
    loading.value = true;

    try {
      const updated = await api<UserProfile>("/auth/onboard", {
        method: "PATCH",
        body: {
          firstName: firstName.value,
          lastName: lastName.value,
          accountType: accountType.value,
        },
      });
      // Onboarding sets account_type server-side, so the cached profile is
      // stale until this resolves and the next page would misroute.
      await refresh();
      // Usually this is the school list, where they request to join. But an
      // address on a school's verified email domain is joined during
      // onboarding, and those users go straight to their home.
      const next = profile.value ?? updated;
      const school = next?.school ?? updated?.school;
      if (school) toast.success(`You've joined ${school.name}`);
      router.push(homePathFor(next));
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Onboarding failed";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  return (
    <AuthPageShell>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Complete your profile</CardTitle>
          <CardDescription>
            {fromSso.value
              ? "You're signed in with your school account. Check your name and tell us who you are."
              : "Tell us a bit about yourself to get started"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName.value}
                  onChange={(e) => (firstName.value = e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName.value}
                  onChange={(e) => (lastName.value = e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label id="account-type-label">I am a…</Label>
              <p className="text-xs text-muted-foreground">
                This decides what you see: students get their own grades,
                staff get the school dashboard.
              </p>
              <div
                role="radiogroup"
                aria-labelledby="account-type-label"
                aria-required="true"
                className="grid gap-2"
              >
                {OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = accountType.value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => (accountType.value = option.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-5 shrink-0",
                          selected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {option.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading.value || !accountType.value}
            >
              {loading.value ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
