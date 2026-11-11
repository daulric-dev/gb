"use client";

import { useCallback, useEffect, useId } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import type { OrganisationFeature } from "@/lib/features";
import { ORGANISATION_PATH } from "@/lib/routing";
import {
  ENGINE_INFO,
  TRANSLATION_ENGINES,
  translationOrgApi,
  type OrgTranslationSettings,
  type OrgTranslationUpdate,
  type TranslationEngine,
} from "@/lib/translation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { OrgHeader } from "../_components/org-header";

const RADIO_CARD =
  "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm font-normal has-data-checked:border-primary has-data-checked:bg-primary/5";

/**
 * The organisation's machine translation service: which engine translates
 * the app and course content for people who pick another language. Saving
 * asks "Confirm it's you" (step-up); the key is write-only.
 */
export default function TranslationSettingsPage() {
  useSignals();
  const id = useId();
  const saved = useSignal<OrgTranslationSettings | null>(null);
  const loadFailed = useSignal(false);
  /** The organisation's `translation` feature switch; null while unknown. */
  const featureOn = useSignal<boolean | null>(null);

  const engine = useSignal<TranslationEngine>("libre");
  const url = useSignal("");
  const key = useSignal("");
  const clearKey = useSignal(false);
  const privateNetwork = useSignal(false);
  const enabled = useSignal(false);
  const saving = useSignal(false);
  const testing = useSignal(false);
  const testResult = useSignal<{ ok: boolean; text: string } | null>(null);

  const fill = useCallback(
    (s: OrgTranslationSettings) => {
      saved.value = s;
      engine.value = s.engine;
      url.value = s.url ?? "";
      key.value = "";
      clearKey.value = false;
      privateNetwork.value = s.allowPrivateNetwork;
      enabled.value = s.enabled;
    },
    [saved, engine, url, key, clearKey, privateNetwork, enabled],
  );

  useEffect(() => {
    translationOrgApi
      .get()
      .then(fill)
      .catch((err) => {
        loadFailed.value = true;
        // The organisation's `translation` feature is off: the note below says so.
        if (err instanceof ApiError && err.code === "FEATURE_DISABLED") {
          featureOn.value = false;
          return;
        }
        toast.error(userMessage(err, "Failed to load the translation settings"));
      });
    api<OrganisationFeature[]>("/organisation/features")
      .then((list) => (featureOn.value = list.find((f) => f.key === "translation")?.enabled ?? false))
      .catch(() => undefined);
  }, [fill, loadFailed, featureOn]);

  const info = ENGINE_INFO[engine.value];
  const libre = engine.value === "libre";
  const trimmedUrl = url.value.trim();
  const httpUrl = /^http:\/\//i.test(trimmedUrl);
  const urlOk = !libre || (/^https?:\/\/\S+$/i.test(trimmedUrl) && (!httpUrl || privateNetwork.value));
  // A key the engine needs: a new one, or the saved one (unless being removed).
  // The API drops the saved key when the engine changes (a key belongs to its engine).
  const keepsSavedKey = !!saved.value?.hasKey && !clearKey.value && engine.value === saved.value.engine;
  const hasUsableKey = !!key.value.trim() || keepsSavedKey;
  const keyOk = !info.needsKey || hasUsableKey;
  const ready = !!saved.value && urlOk && keyOk;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    saving.value = true;
    testResult.value = null;
    try {
      const body: OrgTranslationUpdate = {
        engine: engine.value,
        url: libre ? trimmedUrl : null,
        allowPrivateNetwork: libre && privateNetwork.value,
        enabled: enabled.value,
      };
      if (key.value.trim()) body.key = key.value.trim();
      else if (clearKey.value) body.key = null;
      fill(await translationOrgApi.save(body));
      toast.success("Translation settings saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the translation settings"));
    } finally {
      saving.value = false;
    }
  }

  async function test() {
    testing.value = true;
    testResult.value = null;
    try {
      const r = await translationOrgApi.test();
      testResult.value = r.ok
        ? { ok: true, text: r.sample ? `It works: “${r.sample}”` : "It works." }
        : { ok: false, text: r.message || "The service did not answer." };
    } catch (err) {
      testResult.value = { ok: false, text: userMessage(err, "The test could not run") };
    } finally {
      testing.value = false;
    }
  }

  const dirty =
    !!saved.value &&
    (engine.value !== saved.value.engine ||
      (libre && trimmedUrl !== (saved.value.url ?? "")) ||
      !!key.value.trim() ||
      clearKey.value ||
      (libre && privateNetwork.value !== saved.value.allowPrivateNetwork) ||
      enabled.value !== saved.value.enabled);

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Translation"
        description="The machine translation service used when someone reads GradeBook in another language"
      />

      <Card>
        <CardHeader>
          <CardTitle>What is sent, and where</CardTitle>
          <CardDescription>
            When someone picks a language other than English, the text of each page they view is
            sent to this service: menus and labels, and course content such as pages, assignments,
            quiz questions and announcements, along with any names and comments shown on the page.
            What people type is never sent. For student data, prefer a self-hosted LibreTranslate
            server so text never leaves your network. Translations are machine made and may be
            wrong; teachers can also make a translated draft of an assignment or quiz to review
            before publishing.
          </CardDescription>
        </CardHeader>
      </Card>

      {featureOn.value === false && (
        <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          The <strong>Translation</strong> feature is switched off, so nobody sees the language
          menu yet. Turn it on under{" "}
          <Link href={`${ORGANISATION_PATH}/features`} className="font-medium underline underline-offset-4">
            Features
          </Link>{" "}
          as well as enabling the service below. Schools can switch it off for themselves.
        </p>
      )}

      {!saved.value ? (
        loadFailed.value ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            The translation settings could not be loaded. Reload the page to try again.
          </p>
        ) : (
          <Skeleton className="h-96 w-full" />
        )
      ) : (
        <Card>
          <CardContent>
            <form onSubmit={save} className="space-y-5">
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Service</legend>
                <RadioGroup
                  value={engine.value}
                  onValueChange={(v) => {
                    engine.value = v as TranslationEngine;
                    testResult.value = null;
                  }}
                  className="grid-cols-1 sm:grid-cols-2"
                >
                  {TRANSLATION_ENGINES.map((e) => (
                    <Label key={e} className={RADIO_CARD}>
                      <RadioGroupItem value={e} />
                      <span>
                        {ENGINE_INFO[e].label}
                        <span className="block text-xs text-muted-foreground">
                          {ENGINE_INFO[e].description}
                        </span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>

              {libre && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-url`}>Server URL</Label>
                    <Input
                      id={`${id}-url`}
                      type="url"
                      value={url.value}
                      placeholder="https://translate.example.org"
                      aria-describedby={`${id}-url-help`}
                      aria-invalid={!urlOk}
                      onChange={(e) => (url.value = e.target.value)}
                      required
                    />
                    <p id={`${id}-url-help`} className="text-xs text-muted-foreground">
                      Your LibreTranslate server, or a hosted one. Must use https, unless the
                      server is on your private network (below).
                    </p>
                    {httpUrl && !privateNetwork.value && (
                      <p role="alert" className="text-xs text-destructive">
                        An http address is only allowed for a server on your private network.
                      </p>
                    )}
                  </div>

                  <label htmlFor={`${id}-private`} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      Allow private network address
                      <span id={`${id}-private-help`} className="block text-xs text-muted-foreground">
                        For a LibreTranslate server your organisation runs on its own network (such
                        as 10.x, 192.168.x or localhost), including over plain http.
                        GradeBook&rsquo;s server will send page text to that address inside your
                        network. Leave off for a server on the internet.
                      </span>
                    </span>
                    <Switch
                      id={`${id}-private`}
                      aria-describedby={`${id}-private-help`}
                      checked={privateNetwork.value}
                      onCheckedChange={(v) => (privateNetwork.value = v)}
                    />
                  </label>
                </>
              )}

              {(info.needsKey || info.keyOptional) && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-key`}>
                    API key
                    {info.keyOptional && (
                      <span className="font-normal text-muted-foreground"> (optional)</span>
                    )}
                  </Label>
                  <Input
                    id={`${id}-key`}
                    type="password"
                    autoComplete="off"
                    value={key.value}
                    maxLength={4000}
                    placeholder={keepsSavedKey ? "Leave blank to keep the saved key" : ""}
                    aria-invalid={!keyOk}
                    aria-describedby={`${id}-key-help`}
                    onChange={(e) => (key.value = e.target.value)}
                  />
                  <p id={`${id}-key-help`} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <KeyRound className="size-3.5" aria-hidden />
                    {saved.value.hasKey && engine.value !== saved.value.engine
                      ? "The saved key belongs to the previous service and will be removed. Enter a key for this one."
                      : saved.value.hasKey
                      ? clearKey.value
                        ? "The saved key will be removed when you save."
                        : "A key is saved. It is stored encrypted and never shown again."
                      : "No key saved."}
                    {saved.value.hasKey && engine.value === saved.value.engine && !key.value.trim() && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => (clearKey.value = !clearKey.value)}
                      >
                        {clearKey.value ? "Keep it" : "Remove it"}
                      </Button>
                    )}
                  </p>
                </div>
              )}

              <label htmlFor={`${id}-enabled`} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  Enabled
                  <span id={`${id}-enabled-help`} className="block text-xs text-muted-foreground">
                    Shows the language menu in schools that have the Translation feature on.
                  </span>
                </span>
                <Switch
                  id={`${id}-enabled`}
                  aria-describedby={`${id}-enabled-help`}
                  checked={enabled.value}
                  onCheckedChange={(v) => (enabled.value = v)}
                />
              </label>

              {testResult.value && (
                <p
                  role="status"
                  className={
                    testResult.value.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"
                  }
                >
                  {testResult.value.text}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={!ready || !dirty || saving.value}>
                  {saving.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                  Save
                </Button>
                <Button type="button" variant="outline" disabled={testing.value || saving.value} onClick={() => void test()}>
                  {testing.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                  Test
                </Button>
                <span className="text-xs text-muted-foreground">
                  {dirty ? "Test checks the saved settings: save first." : "Test checks the saved settings."}
                  {saved.value.updatedAt && ` Last saved ${new Date(saved.value.updatedAt).toLocaleString()}.`}
                </span>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
