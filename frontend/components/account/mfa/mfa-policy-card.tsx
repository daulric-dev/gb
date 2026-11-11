"use client";

import { useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { userMessage } from "@/lib/errors";
import { getMfaPolicy, setMfaPolicy } from "./mfa-api";

/**
 * Organisation console: require an authenticator app for administrators and
 * anyone holding the safeguarding permission. Changing it asks "Confirm it's
 * you".
 */
export function MfaPolicyCard() {
  useSignals();
  const value = useSignal<boolean | null>(null);
  const saving = useSignal(false);

  useEffect(() => {
    getMfaPolicy()
      .then((p) => (value.value = p.requireMfaForAdmins))
      .catch(() => (value.value = null));
  }, [value]);

  async function change(next: boolean) {
    saving.value = true;
    try {
      const res = await setMfaPolicy(next);
      value.value = res.requireMfaForAdmins;
      toast.success(next ? "Authenticator apps are now required" : "Authenticator apps are now optional");
    } catch (err) {
      toast.error(userMessage(err, "Could not change the setting"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <Card className="max-w-xl" id="two-step">
      <CardHeader>
        <CardTitle>Two-step verification</CardTitle>
        <CardDescription>
          Anyone can add an authenticator app to their account. This makes it
          compulsory for organisation and school administrators and for anyone
          with the safeguarding permission.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {value.value === null ? (
          <Skeleton className="h-6 w-64" />
        ) : (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="require-mfa">
              Require an authenticator app for admins and safeguarding roles
            </Label>
            <Switch
              id="require-mfa"
              checked={value.value}
              disabled={saving.value}
              onCheckedChange={(checked) => void change(checked)}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          It applies at each person&apos;s next sign-in with an emailed code: if
          they have no app yet, they must set one up before they can do anything
          else. Single sign-on users who set one up are asked for it too; those
          who have not rely on your identity provider&apos;s own multi-factor
          settings.
        </p>
      </CardContent>
    </Card>
  );
}
