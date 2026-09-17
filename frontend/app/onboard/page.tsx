"use client";

import { useRouter } from "next/navigation";
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
    description: "You have a claim code from your school",
    icon: GraduationCap,
  },
];

export default function OnboardPage() {
  useSignals();

  const router = useRouter();
  const firstName = useSignal("");
  const lastName = useSignal("");
  const accountType = useSignal<AccountType>("staff");
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    try {
      await api("/auth/onboard", {
        method: "PATCH",
        body: {
          firstName: firstName.value,
          lastName: lastName.value,
          accountType: accountType.value,
        },
      });
      // Neither branch grants anything on its own: staff still need an admin to
      // approve their join request, students still need a valid claim code.
      router.push(accountType.value === "student" ? "/claim" : "/schools");
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
            Tell us a bit about yourself to get started
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
              <Label>I am joining as</Label>
              <div
                role="radiogroup"
                aria-label="Account type"
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

            <Button type="submit" className="w-full" disabled={loading.value}>
              {loading.value ? "Saving..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthPageShell>
  );
}
