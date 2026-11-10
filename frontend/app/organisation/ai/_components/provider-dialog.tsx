"use client";

import { useId } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { userMessage } from "@/lib/errors";
import {
  aiOrgApi,
  type AiProvider,
  type AiProviderKind,
} from "@/lib/ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const RADIO_CARD =
  "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm font-normal has-data-checked:border-primary has-data-checked:bg-primary/5";

/**
 * Add or edit an AI provider. The API key is write-only: editing shows only
 * its last four characters and a blank field keeps it. Saving asks "Confirm
 * it's you" (step-up). Testing happens on the saved provider, from the list.
 */
export function ProviderDialog({
  open,
  provider,
  suggestions,
  onOpenChangeAction,
  onSavedAction,
}: {
  open: boolean;
  /** The provider being edited, or null to add one. */
  provider: AiProvider | null;
  suggestions: Record<AiProviderKind, string[]>;
  onOpenChangeAction: (open: boolean) => void;
  onSavedAction: (provider: AiProvider) => void;
}) {
  useSignals();
  const id = useId();
  const editing = !!provider;
  const kind = useSignal<AiProviderKind>(provider?.kind ?? "anthropic");
  const name = useSignal(provider?.name ?? "");
  const baseUrl = useSignal(provider?.baseUrl ?? "");
  const model = useSignal(provider?.model ?? "claude-opus-5-5");
  const apiKey = useSignal("");
  const cap = useSignal(provider?.monthlyCap ? String(provider.monthlyCap) : "");
  const makeDefault = useSignal(false);
  const privateNetwork = useSignal(provider?.allowPrivateNetwork ?? false);
  const availableToSchools = useSignal(provider?.availableToSchools ?? true);
  const saving = useSignal(false);

  const openai = kind.value === "openai_compatible";
  const capValue = cap.value.trim();
  const capOk = capValue === "" || /^[1-9]\d{0,7}$/.test(capValue);
  const httpUrl = /^http:\/\//i.test(baseUrl.value.trim());
  const ready =
    (!httpUrl || privateNetwork.value) &&
    name.value.trim() &&
    model.value.trim() &&
    (!openai || baseUrl.value.trim()) &&
    (editing || apiKey.value.trim()) &&
    capOk;

  function changeKind(next: AiProviderKind) {
    kind.value = next;
    if (!editing) {
      model.value = suggestions[next]?.[0] ?? "";
      if (!name.value.trim() || name.value === "Anthropic" || name.value === "OpenAI-compatible") {
        name.value = next === "anthropic" ? "Anthropic" : "OpenAI-compatible";
      }
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    saving.value = true;
    try {
      const body: Record<string, unknown> = {
        name: name.value.trim(),
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        monthlyCap: capValue ? Number(capValue) : null,
        allowPrivateNetwork: privateNetwork.value,
        availableToSchools: availableToSchools.value,
        ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {}),
      };
      const saved = editing
        ? await aiOrgApi.update(provider.id, body)
        : await aiOrgApi.create({ ...body, kind: kind.value, isDefault: makeDefault.value });
      toast.success(editing ? "Provider saved" : "Provider added");
      onSavedAction(saved);
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the provider"));
    } finally {
      saving.value = false;
    }
  }

  const listId = `${id}-models`;

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${provider.name}` : "Add an AI provider"}</DialogTitle>
            <DialogDescription>
              Your organisation&rsquo;s own account with an AI service. Requests from teachers go
              there, billed to you. The API key is stored encrypted and never shown again.
            </DialogDescription>
          </DialogHeader>

          {!editing && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Type</legend>
              <RadioGroup
                value={kind.value}
                onValueChange={(v) => changeKind(v as AiProviderKind)}
                className="grid-cols-1 sm:grid-cols-2"
              >
                <Label className={RADIO_CARD}>
                  <RadioGroupItem value="anthropic" />
                  <span>
                    Anthropic
                    <span className="block text-xs text-muted-foreground">
                      Claude models, with an API key from the Claude Console
                    </span>
                  </span>
                </Label>
                <Label className={RADIO_CARD}>
                  <RadioGroupItem value="openai_compatible" />
                  <span>
                    OpenAI-compatible
                    <span className="block text-xs text-muted-foreground">
                      OpenAI, Azure, OpenRouter, or a local Ollama / vLLM / LM Studio server
                    </span>
                  </span>
                </Label>
              </RadioGroup>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Display name</Label>
            <Input
              id={`${id}-name`}
              value={name.value}
              maxLength={80}
              placeholder={openai ? "OpenRouter" : "Anthropic"}
              onChange={(e) => (name.value = e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-base`}>
              Base URL{!openai && <span className="font-normal text-muted-foreground"> (optional)</span>}
            </Label>
            <Input
              id={`${id}-base`}
              type="url"
              value={baseUrl.value}
              placeholder={openai ? "https://api.openai.com/v1" : "https://api.anthropic.com"}
              aria-describedby={`${id}-base-help`}
              onChange={(e) => (baseUrl.value = e.target.value)}
              required={openai}
            />
            <p id={`${id}-base-help`} className="text-xs text-muted-foreground">
              {openai
                ? "The address that ends before /chat/completions. Must use https, unless the provider runs on your private network (below)."
                : "Leave empty to use Anthropic's API. Fill in only for a gateway in front of it."}
            </p>
            {httpUrl && !privateNetwork.value && (
              <p role="alert" className="text-xs text-destructive">
                An http address is only allowed for a provider on your private network.
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border p-3">
            <Checkbox
              id={`${id}-private`}
              checked={privateNetwork.value}
              onCheckedChange={(v) => (privateNetwork.value = v === true)}
              aria-describedby={`${id}-private-help`}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor={`${id}-private`} className="font-medium">
                This provider runs on our private network (e.g. a local Ollama/vLLM server)
              </Label>
              <p id={`${id}-private-help`} className="text-xs text-muted-foreground">
                Lets GradeBook reach this provider at a private or local address (such as
                10.x, 192.168.x or localhost), and over plain http. Only this provider gets this
                permission; every other provider is still refused private addresses. Addresses are
                still checked on every request, redirects are never followed and answers are size
                limited. Tick it only for a server your organisation runs: GradeBook&rsquo;s server
                will send requests, with this provider&rsquo;s key, inside your network.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-model`}>Model</Label>
            <Input
              id={`${id}-model`}
              list={listId}
              value={model.value}
              maxLength={200}
              aria-describedby={`${id}-model-help`}
              onChange={(e) => (model.value = e.target.value)}
              required
            />
            <datalist id={listId}>
              {(suggestions[kind.value] ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p id={`${id}-model-help`} className="text-xs text-muted-foreground">
              The provider&rsquo;s model id. Pick a suggestion or type any id the provider offers.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-key`}>API key</Label>
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              value={apiKey.value}
              maxLength={4000}
              placeholder={editing ? `Leave empty to keep the key ending ${provider.keyLast4}` : ""}
              onChange={(e) => (apiKey.value = e.target.value)}
              required={!editing}
            />
            {openai && (
              <p className="text-xs text-muted-foreground">
                Local servers that need no key accept any text here.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-cap`}>
              Monthly request limit <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${id}-cap`}
              inputMode="numeric"
              value={cap.value}
              placeholder="No limit"
              aria-invalid={!capOk}
              onChange={(e) => (cap.value = e.target.value)}
              className="w-40"
            />
          </div>

          <label htmlFor={`${id}-schools`} className="flex items-start justify-between gap-3 text-sm">
            <span>
              Available to schools
              <span id={`${id}-schools-help`} className="block text-xs text-muted-foreground">
                Schools can choose this provider in their AI settings. Schools never add providers,
                keys or models.
              </span>
            </span>
            <Switch
              id={`${id}-schools`}
              aria-describedby={`${id}-schools-help`}
              checked={availableToSchools.value}
              onCheckedChange={(v) => (availableToSchools.value = v)}
            />
          </label>

          {!editing && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Make it the organisation default (used by schools that do not choose another)
              <Switch checked={makeDefault.value} onCheckedChange={(v) => (makeDefault.value = v)} />
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)} disabled={saving.value}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || saving.value}>
              {saving.value && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {editing ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
