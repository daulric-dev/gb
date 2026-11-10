"use client";

import { useRouter } from "next/navigation";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { formatLinkCode, isCompleteLinkCode, personName } from "@/lib/parent";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Linked {
  studentId: string;
  child: { firstName: string | null; lastName: string | null };
  school: { name: string | null };
}

/**
 * Finish linking: an emailed invitation (`token`) or a code typed here.
 * Asks for a name when the account has none yet.
 */
export function ParentJoinForm({ token }: { token?: string | null }) {
  useSignals();
  const router = useRouter();
  const { profile, refresh } = useAuth();
  const needsName = !profile.value?.first_name;

  const code = useSignal("");
  const firstName = useSignal("");
  const lastName = useSignal("");
  const busy = useSignal(false);
  const error = useSignal<string | null>(null);
  const done = useSignal<Linked | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.value) return;
    if (needsName && !firstName.value.trim()) {
      error.value = "Enter your first name";
      return;
    }
    if (!token && !isCompleteLinkCode(code.value)) {
      error.value = "Enter the 10-character code from the school";
      return;
    }
    busy.value = true;
    error.value = null;
    const names = needsName
      ? { firstName: firstName.value.trim(), lastName: lastName.value.trim() }
      : {};
    try {
      const res = token
        ? await api<Linked>("/parent/link/accept", { method: "POST", body: { token, ...names } })
        : await api<Linked>("/parent/link/redeem", {
            method: "POST",
            body: { code: code.value, ...names },
          });
      await refresh();
      done.value = res;
    } catch (err) {
      error.value = userMessage(err, "That did not work");
    } finally {
      busy.value = false;
    }
  }

  if (done.value) {
    const linked = done.value;
    return (
      <Card>
        <CardHeader>
          <CardTitle>You are linked</CardTitle>
          <CardDescription>
            You can now follow {personName(linked.child, "your child")}
            {linked.school.name ? ` at ${linked.school.name}` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push(`/parent/${linked.studentId}`)}>Open the parent portal</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{token ? "Accept the invitation" : "Link your child"}</CardTitle>
        <CardDescription>
          {token
            ? "Confirm to follow your child's grades, work and attendance. It is read-only."
            : "Enter the one-time code your child's school gave you."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!token && (
            <div className="space-y-1.5">
              <Label htmlFor="link-code">Code</Label>
              <Input
                id="link-code"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                placeholder="ABCDE-FGHJK"
                value={code.value}
                onChange={(e) => (code.value = formatLinkCode(e.target.value))}
              />
            </div>
          )}
          {needsName && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="parent-first">First name</Label>
                <Input
                  id="parent-first"
                  autoComplete="given-name"
                  value={firstName.value}
                  onChange={(e) => (firstName.value = e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parent-last">Last name</Label>
                <Input
                  id="parent-last"
                  autoComplete="family-name"
                  value={lastName.value}
                  onChange={(e) => (lastName.value = e.target.value)}
                />
              </div>
            </div>
          )}
          {error.value && (
            <p role="alert" className="text-sm text-destructive">
              {error.value}
            </p>
          )}
          <Button type="submit" disabled={busy.value} className="w-full">
            {busy.value ? "Linking…" : token ? "Accept" : "Link"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
