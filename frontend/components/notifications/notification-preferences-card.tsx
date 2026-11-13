"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Bell } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  getNotificationPreferences,
  isOn,
  preferenceRows,
  updateNotificationPreferences,
  withPreference,
  type NotificationChannel,
  type NotificationPreferences,
} from "@/lib/notification-preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

/**
 * The signed-in account's notification preferences (staff and students):
 * each category on or off for push and for email. Parents keep their own
 * settings for notices about their children on /parent/settings.
 */
export function NotificationPreferencesCard() {
  useSignals();
  const prefs = useSignal<NotificationPreferences | null>(null);
  const failed = useSignal(false);
  const saving = useSignal<string | null>(null);

  useEffect(() => {
    getNotificationPreferences()
      .then((p) => (prefs.value = p))
      .catch(() => (failed.value = true));
  }, [prefs, failed]);

  async function toggle(channel: NotificationChannel, key: string, on: boolean) {
    const before = prefs.value;
    if (!before) return;
    prefs.value = withPreference(before, channel, key, on);
    saving.value = `${channel}:${key}`;
    try {
      prefs.value = await updateNotificationPreferences({ [channel]: { [key]: on } });
    } catch (err) {
      prefs.value = before;
      toast.error(userMessage(err, "Could not save"));
    } finally {
      saving.value = null;
    }
  }

  if (failed.value) return null;
  const p = prefs.value;

  return (
    <Card className="p-6">
      <CardHeader className="px-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="size-4" aria-hidden="true" />
          Notifications
        </CardTitle>
        <CardDescription>
          Choose what you are told about, on the mobile app (push) and by email. Sign-in codes
          and security alerts are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {!p ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 font-medium">Category</th>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th key={c} className="w-28 py-2 text-center font-medium">
                    {CHANNEL_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {preferenceRows(p).map((row) => (
                <tr key={row.key}>
                  <td className="py-2">{row.label}</td>
                  {NOTIFICATION_CHANNELS.map((c) => (
                    <td key={c} className="py-2 text-center">
                      <Switch
                        checked={isOn(p, c, row.key)}
                        disabled={saving.value !== null}
                        aria-label={`${row.label}: ${CHANNEL_LABELS[c]}`}
                        onCheckedChange={(on) => void toggle(c, row.key, on)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
