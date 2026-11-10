"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, Star } from "lucide-react";
import { isFeatureDisabledError } from "@/lib/features";
import { userMessage } from "@/lib/errors";
import {
  aiOrgApi,
  PROVIDER_KIND_LABEL,
  type AiOrgSettings,
  type AiProvider,
  type AiProviderList,
  type AiUsageRow,
} from "@/lib/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OrgHeader } from "../_components/org-header";
import { ProviderDialog } from "./_components/provider-dialog";

const FEATURE_LABEL: Record<string, string> = {
  quiz_questions: "Quiz questions",
  rubric_feedback: "Rubric feedback",
  page_summary: "Page summary",
  test: "Connection test",
};

/**
 * The organisation's AI providers (bring your own: Anthropic or any
 * OpenAI-compatible service), organisation-wide AI settings and the
 * request log. Organisation admins only, while `ai_assistance` is on.
 */
export default function AiProvidersPage() {
  useSignals();
  const list = useSignal<AiProviderList | null>(null);
  const settings = useSignal<AiOrgSettings | null>(null);
  const usage = useSignal<{ thisMonth: number; requests: AiUsageRow[] } | null>(null);
  const off = useSignal(false);
  const editing = useSignal<AiProvider | null>(null);
  const dialogOpen = useSignal(false);
  const formKey = useSignal(0);
  const removing = useSignal<AiProvider | null>(null);
  const testing = useSignal<string | null>(null);
  const testResult = useSignal<Record<string, { ok: boolean; message: string }>>({});
  const limit = useSignal("30");
  const savingSettings = useSignal(false);
  const togglingId = useSignal<string | null>(null);

  const load = useCallback(() => {
    Promise.all([aiOrgApi.list(), aiOrgApi.settings(), aiOrgApi.usage()])
      .then(([l, s, u]) => {
        list.value = l;
        settings.value = s;
        limit.value = String(s.userHourlyLimit);
        usage.value = u;
        off.value = false;
      })
      .catch((err) => {
        if (isFeatureDisabledError(err)) off.value = true;
        else toast.error(userMessage(err, "Failed to load the AI providers"));
      });
  }, [list, settings, usage, off, limit]);
  useEffect(load, [load]);

  function openDialog(p: AiProvider | null) {
    editing.value = p;
    formKey.value = formKey.value + 1;
    dialogOpen.value = true;
  }

  async function test(p: AiProvider) {
    testing.value = p.id;
    try {
      const r = await aiOrgApi.test(p.id);
      testResult.value = { ...testResult.value, [p.id]: r };
      aiOrgApi.usage().then((u) => (usage.value = u)).catch(() => undefined);
    } catch (err) {
      toast.error(userMessage(err, "The test could not run"));
    } finally {
      testing.value = null;
    }
  }

  async function makeDefault(p: AiProvider) {
    try {
      await aiOrgApi.setDefault(p.id);
      toast.success(`${p.name} is now the default`);
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to change the default"));
    }
  }

  async function setAvailable(p: AiProvider, availableToSchools: boolean) {
    togglingId.value = p.id;
    try {
      await aiOrgApi.update(p.id, { availableToSchools });
      toast.success(
        availableToSchools ? `Schools can now choose ${p.name}` : `${p.name} is no longer offered to schools`,
      );
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to change who can use the provider"));
    } finally {
      togglingId.value = null;
    }
  }

  async function remove() {
    const p = removing.value;
    if (!p) return;
    try {
      await aiOrgApi.remove(p.id);
      toast.success("Provider removed");
      load();
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove the provider"));
    } finally {
      removing.value = null;
    }
  }

  async function saveSettings(patch: Partial<AiOrgSettings>) {
    savingSettings.value = true;
    try {
      settings.value = await aiOrgApi.saveSettings(patch);
      toast.success("AI settings saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the AI settings"));
    } finally {
      savingSettings.value = false;
    }
  }

  const header = (
    <OrgHeader
      title="AI providers"
      description="The AI service teachers' drafts are generated with, on your organisation's own account"
      action={
        !off.value &&
        list.value && (
          <Button onClick={() => openDialog(null)}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            Add provider
          </Button>
        )
      }
    />
  );

  if (off.value) {
    return (
      <div className="space-y-6">
        {header}
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          AI assistance is turned off. Switch on &ldquo;AI assistance&rdquo; under Features to set
          up a provider.
        </p>
      </div>
    );
  }

  const providers = list.value?.providers ?? [];
  const limitValue = Number(limit.value);
  const limitOk = Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 1000;

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardHeader>
          <CardTitle>What is sent, and where</CardTitle>
          <CardDescription>
            Teachers ask for drafts: quiz questions from a page or pasted text, rubric feedback
            suggestions, and page summaries. Each request goes to the provider the school chose
            among those you make available to schools, or to the default provider below, on your
            account. You set each provider&rsquo;s model; schools only choose a provider. Student names and email addresses are replaced with placeholders before
            anything is sent. Students&rsquo; work is sent only for rubric feedback, and only in
            schools that allow it in their settings. The AI never marks work and nothing it returns
            is saved until a teacher accepts it. Each school can switch AI assistance off.
          </CardDescription>
        </CardHeader>
      </Card>

      <section aria-labelledby="providers-heading" className="space-y-3">
        <h2 id="providers-heading" className="text-lg font-semibold">
          Providers
        </h2>
        {!list.value ? (
          <Skeleton className="h-32 w-full" />
        ) : providers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No provider yet. Add an Anthropic API key, or any OpenAI-compatible service (OpenAI,
            Azure, OpenRouter, or a model running on your own server).
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {providers.map((p) => {
              const result = testResult.value[p.id];
              return (
                <li key={p.id} className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {PROVIDER_KIND_LABEL[p.kind]} · {p.model}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{p.host}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {p.isDefault && <Badge>Default</Badge>}
                      {p.allowPrivateNetwork && <Badge variant="outline">Private network</Badge>}
                    </div>
                  </div>
                  <label
                    htmlFor={`ai-available-${p.id}`}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <span>
                      Available to schools
                      <span id={`ai-available-${p.id}-help`} className="block text-xs text-muted-foreground">
                        {p.availableToSchools
                          ? p.isDefault
                            ? "Schools use it unless they choose another provider."
                            : "Schools can choose it in their AI settings."
                          : p.isDefault
                            ? "Not offered: schools without their own choice have no AI provider."
                            : "Not offered to schools; schools that chose it use the default."}
                      </span>
                    </span>
                    <Switch
                      id={`ai-available-${p.id}`}
                      aria-describedby={`ai-available-${p.id}-help`}
                      checked={p.availableToSchools}
                      disabled={togglingId.value === p.id}
                      onCheckedChange={(v) => void setAvailable(p, v)}
                    />
                  </label>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="size-3.5" aria-hidden />
                    Key ending {p.keyLast4}
                    {p.keyUnreadable && (
                      <span className="text-destructive"> · cannot be read, enter it again</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.usedThisMonth ?? 0} request{p.usedThisMonth === 1 ? "" : "s"} this month
                    {p.monthlyCap ? ` of ${p.monthlyCap}` : ""}
                  </p>
                  {result && (
                    <p
                      role="status"
                      className={result.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}
                    >
                      {result.message}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={testing.value === p.id} onClick={() => void test(p)}>
                      {testing.value === p.id && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
                      Test
                    </Button>
                    {!p.isDefault && (
                      <Button size="sm" variant="outline" onClick={() => void makeDefault(p)}>
                        <Star className="mr-1.5 size-3.5" aria-hidden />
                        Make default
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openDialog(p)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => (removing.value = p)}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {settings.value && (
        <Card>
          <CardHeader>
            <CardTitle>Limits and logging</CardTitle>
            <CardDescription>
              Every request is logged (who, which feature, provider, model, tokens, result) without
              its content. Each provider can also have a monthly limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-hourly">Requests per teacher per hour</Label>
                <Input
                  id="ai-hourly"
                  inputMode="numeric"
                  className="w-32"
                  value={limit.value}
                  aria-invalid={!limitOk}
                  onChange={(e) => (limit.value = e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!limitOk || savingSettings.value || limitValue === settings.value.userHourlyLimit}
                onClick={() => void saveSettings({ userHourlyLimit: limitValue })}
              >
                Save limit
              </Button>
            </div>
            <label className="flex items-start justify-between gap-4 text-sm">
              <span>
                Keep prompts for 30 days (debugging)
                <span className="block text-xs text-muted-foreground">
                  Stores what was sent and received with each request, then deletes it after 30
                  days. Off by default; turning it off deletes what was kept.
                </span>
              </span>
              <Switch
                checked={settings.value.keepPrompts}
                disabled={savingSettings.value}
                onCheckedChange={(v) => void saveSettings({ keepPrompts: v })}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {usage.value && (
        <section aria-labelledby="usage-heading" className="space-y-2">
          <h2 id="usage-heading" className="text-lg font-semibold">
            Recent requests
          </h2>
          <p className="text-sm text-muted-foreground">
            {usage.value.thisMonth} request{usage.value.thisMonth === 1 ? "" : "s"} this month.
          </p>
          {usage.value.requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">The newest AI requests</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">When</th>
                    <th scope="col" className="px-3 py-2 font-medium">Feature</th>
                    <th scope="col" className="px-3 py-2 font-medium">Provider</th>
                    <th scope="col" className="px-3 py-2 font-medium">Result</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Tokens in / out</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.value.requests.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                      <td className="px-3 py-2">
                        {r.provider} <span className="text-muted-foreground">({r.model})</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.status}
                        {r.error && <span className="block text-xs text-muted-foreground">{r.error}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inputTokens ?? "-"} / {r.outputTokens ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {list.value && (
        <ProviderDialog
          key={formKey.value}
          open={dialogOpen.value}
          provider={editing.value}
          suggestions={list.value.suggestions}
          onOpenChangeAction={(o) => (dialogOpen.value = o)}
          onSavedAction={() => {
            dialogOpen.value = false;
            load();
          }}
        />
      )}

      <AlertDialog open={!!removing.value} onOpenChange={(o) => !o && (removing.value = null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing.value?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its API key is deleted. The request log keeps the provider&rsquo;s name. If it was
              the default, the oldest other provider becomes the default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
