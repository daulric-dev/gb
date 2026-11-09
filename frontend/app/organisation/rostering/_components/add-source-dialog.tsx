"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { ROSTERING_API, type RosterSource, type SourceKind } from "@/lib/rostering";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
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
 * Add a rostering source: CSV uploads, or a OneRoster 1.2 endpoint with
 * OAuth2 client credentials ("Test connection" before saving). Saving asks
 * "Confirm it's you" (step-up): it stores credentials.
 */
export function AddSourceDialog({
  open,
  onOpenChangeAction,
  onCreatedAction,
}: {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  onCreatedAction: (source: RosterSource) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceKind>("csv");
  const [baseUrl, setBaseUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [daily, setDaily] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const api_ = kind === "oneroster_api";
  const ready = name.trim() && (!api_ || (baseUrl.trim() && tokenUrl.trim() && clientId.trim() && clientSecret));

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      setTest(
        await api<{ ok: boolean; message: string }>(`${ROSTERING_API}/test-connection`, {
          method: "POST",
          body: { baseUrl: baseUrl.trim(), tokenUrl: tokenUrl.trim(), clientId: clientId.trim(), clientSecret },
        }),
      );
    } catch (err) {
      setTest({ ok: false, message: userMessage(err, "The test could not run") });
    } finally {
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      const source = await api<RosterSource>(`${ROSTERING_API}/sources`, {
        method: "POST",
        stepUp: true,
        body: {
          name: name.trim(),
          kind,
          ...(api_
            ? {
                baseUrl: baseUrl.trim(),
                tokenUrl: tokenUrl.trim(),
                clientId: clientId.trim(),
                clientSecret,
                schedule: daily ? "daily" : "off",
                autoApply,
              }
            : {}),
        },
      });
      toast.success("Source added");
      onCreatedAction(source);
    } catch (err) {
      toast.error(userMessage(err, "Failed to add the source"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a rostering source</DialogTitle>
            <DialogDescription>
              Where students, staff, classes and enrolments come from. Every sync starts with a dry
              run you review before anything changes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              placeholder="District SIS"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Type</legend>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as SourceKind)} className="grid-cols-1 sm:grid-cols-2">
              <Label className={RADIO_CARD}>
                <RadioGroupItem value="csv" />
                <span>
                  CSV upload
                  <span className="block text-xs text-muted-foreground">
                    A OneRoster CSV bundle (.zip) or GradeBook&apos;s templates
                  </span>
                </span>
              </Label>
              <Label className={RADIO_CARD}>
                <RadioGroupItem value="oneroster_api" />
                <span>
                  OneRoster 1.2 endpoint
                  <span className="block text-xs text-muted-foreground">Synced from your SIS over its API</span>
                </span>
              </Label>
            </RadioGroup>
          </fieldset>

          {api_ && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-base`}>Endpoint URL</Label>
                <Input
                  id={`${id}-base`}
                  value={baseUrl}
                  inputMode="url"
                  placeholder="https://sis.example.org/ims/oneroster/rostering/v1p2"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-token`}>Token URL</Label>
                <Input
                  id={`${id}-token`}
                  value={tokenUrl}
                  inputMode="url"
                  placeholder="https://sis.example.org/oauth/token"
                  onChange={(e) => setTokenUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-client`}>Client ID</Label>
                  <Input id={`${id}-client`} value={clientId} autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-secret`}>Client secret</Label>
                  <Input
                    id={`${id}-secret`}
                    type="password"
                    value={clientSecret}
                    autoComplete="new-password"
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testing || !baseUrl || !tokenUrl || !clientId || !clientSecret}
                  onClick={() => void testConnection()}
                >
                  {testing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <PlugZap className="mr-1.5 size-4" />}
                  Test connection
                </Button>
                {test && (
                  <p role="status" className={test.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>
                    {test.message}
                  </p>
                )}
              </div>
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor={`${id}-daily`} className="font-normal">
                  Sync daily
                  <span className="block text-xs text-muted-foreground">
                    A dry run every day. You review it, unless auto-apply is on.
                  </span>
                </Label>
                <Switch id={`${id}-daily`} checked={daily} onCheckedChange={setDaily} />
              </div>
              {daily && (
                <div className="flex items-start justify-between gap-3">
                  <Label htmlFor={`${id}-auto`} className="font-normal">
                    Apply new and changed records automatically
                    <span className="block text-xs text-muted-foreground">
                      Records to disable always wait for you to confirm.
                    </span>
                  </Label>
                  <Switch id={`${id}-auto`} checked={autoApply} onCheckedChange={setAutoApply} />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChangeAction(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Add source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
