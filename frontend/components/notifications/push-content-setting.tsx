"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Loader2, Smartphone } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  effectivePushText,
  fromChoice,
  getPushContent,
  PUSH_CONTENT_LABELS,
  setPushContent,
  toChoice,
  unsetLabel,
  type PushContentScope,
  type PushContentView,
} from "@/lib/push-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOptionalCan } from "@/providers/PermissionsProvider";

/**
 * What push notifications show on the lock screen: the school's setting
 * (`school:update`, overrides the organisation's) or the organisation's
 * default (organisation console). Saved on change; audited by the API.
 */
export function PushContentSetting({ scope }: { scope: PushContentScope }) {
  useSignals();
  const view = useSignal<PushContentView | null>(null);
  const failed = useSignal(false);
  const saving = useSignal(false);
  // The school's setting needs school:update; the organisation console has
  // no permissions provider (its guard is organisation admin).
  const allowed = useOptionalCan()("school", "update") || scope === "organisation";

  useEffect(() => {
    if (!allowed) return;
    getPushContent(scope)
      .then((v) => (view.value = v))
      .catch(() => (failed.value = true));
  }, [allowed, scope, view, failed]);

  async function change(choice: string) {
    saving.value = true;
    try {
      view.value = await setPushContent(scope, fromChoice(choice));
      toast.success("Saved");
    } catch (err) {
      toast.error(userMessage(err, "Could not save"));
    } finally {
      saving.value = false;
    }
  }

  // No permission (403) or an older server: nothing to show.
  if (!allowed || failed.value) return null;
  const v = view.value;
  const id = `push-content-${scope}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" aria-hidden="true" />
          Push notification content
        </CardTitle>
        <CardDescription>
          Generic notices say only &ldquo;You have a new update&rdquo;; the details load in the app
          after the phone is unlocked. That keeps children&apos;s names and marks off lock screens
          and out of Expo, Apple and Google, which deliver the notifications.
          {scope === "school" ? " This school's choice overrides the organisation's." : " Schools can override this."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!v ? (
          <Skeleton className="h-9 w-full max-w-sm" />
        ) : (
          <>
            <Label htmlFor={id}>What notifications show</Label>
            <div className="flex items-center gap-2">
              <NativeSelect
                id={id}
                className="w-full max-w-sm"
                value={toChoice(v.value)}
                disabled={saving.value}
                onChange={(e) => void change(e.target.value)}
              >
                <NativeSelectOption value="unset">{unsetLabel(v, scope)}</NativeSelectOption>
                <NativeSelectOption value="full">{PUSH_CONTENT_LABELS.full}</NativeSelectOption>
                <NativeSelectOption value="generic">{PUSH_CONTENT_LABELS.generic}</NativeSelectOption>
              </NativeSelect>
              {saving.value && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground">{effectivePushText(v, scope)}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
