"use client";

import { useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  NOTICE_KINDS,
  NOTICE_LABELS,
  personName,
  relationshipText,
  toggleNoticeKind,
  type ParentNotificationPrefs,
} from "@/lib/parent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useParentChildren } from "../_components/parent-context";

/** Linked children, adding another, and notice preferences. */
export default function ParentSettingsPage() {
  useSignals();
  const { children } = useParentChildren();
  const notificationsOn = children.some((c) => c.visibility.notifications);
  const prefs = useSignal<ParentNotificationPrefs | null>(null);
  const saving = useSignal(false);

  useEffect(() => {
    if (!notificationsOn) return;
    api<ParentNotificationPrefs>("/parent/notifications/preferences")
      .then((p) => (prefs.value = p))
      .catch(() => (prefs.value = null));
  }, [notificationsOn, prefs]);

  async function save(patch: Partial<ParentNotificationPrefs>) {
    if (!prefs.value) return;
    const before = prefs.value;
    prefs.value = { ...before, ...patch };
    saving.value = true;
    try {
      prefs.value = await api<ParentNotificationPrefs>("/parent/notifications/preferences", {
        method: "PUT",
        body: patch,
      });
    } catch (err) {
      prefs.value = before;
      toast.error(userMessage(err, "Could not save"));
    } finally {
      saving.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your children</CardTitle>
          <CardDescription>Children the school has linked to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y">
              {children.map((c) => (
                <li key={c.id} className="py-2">
                  <p className="text-sm font-medium">{personName(c, "Child")}</p>
                  <p className="text-xs text-muted-foreground">
                    {[c.school.name, relationshipText(c.relationship, c.relationshipLabel)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" nativeButton={false} render={<Link href="/parent/link" />}>
            Link another child with a code
          </Button>
        </CardContent>
      </Card>

      {notificationsOn && prefs.value && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
            <CardDescription>
              Both are off until you turn them on. Push notices go to the GradeBook app where you
              are signed in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="parent-email">Email</Label>
              <Switch
                id="parent-email"
                checked={prefs.value.emailEnabled}
                disabled={saving.value}
                onCheckedChange={(on) => void save({ emailEnabled: on })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="parent-push">Push (mobile app)</Label>
              <Switch
                id="parent-push"
                checked={prefs.value.pushEnabled}
                disabled={saving.value}
                onCheckedChange={(on) => void save({ pushEnabled: on })}
              />
            </div>
            <fieldset className="space-y-3 border-t pt-4">
              <legend className="text-sm font-medium">Tell me about</legend>
              {NOTICE_KINDS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`kind-${k}`}>{NOTICE_LABELS[k]}</Label>
                  <Switch
                    id={`kind-${k}`}
                    checked={prefs.value!.kinds.includes(k)}
                    disabled={saving.value}
                    onCheckedChange={(on) =>
                      void save({ kinds: toggleNoticeKind(prefs.value!.kinds, k, on) })
                    }
                  />
                </div>
              ))}
            </fieldset>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
