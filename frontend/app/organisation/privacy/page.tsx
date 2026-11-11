"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { OrgHeader } from "../_components/org-header";
import {
  CATEGORY_LABELS,
  FIELD_LABELS,
  fetchPrivacyNotice,
  type PrivacyNotice,
  type PrivacySettings,
} from "@/app/privacy/_lib/notice";

type TextField =
  | "controllerName"
  | "controllerAddress"
  | "privacyEmail"
  | "dpoName"
  | "dpoEmail"
  | "supervisoryAuthorityName"
  | "supervisoryAuthorityUrl"
  | "dataLocation";

type Form = Record<TextField, string> & {
  lawfulBases: Record<string, string[]>;
  additionalRecipients: { name: string; purpose: string; location: string }[];
};

/** Short labels for the basis choices (the notice shows the full wording). */
const BASES: { key: string; label: string; special?: boolean }[] = [
  { key: "public_task", label: "Public task" },
  { key: "legitimate_interests", label: "Legitimate interests" },
  { key: "legal_obligation", label: "Legal obligation" },
  { key: "vital_interests", label: "Vital interests" },
  { key: "contract", label: "Contract" },
  { key: "consent", label: "Consent" },
  { key: "art9_substantial_public_interest", label: "Art 9: substantial public interest", special: true },
  { key: "art9_vital_interests", label: "Art 9: vital interests", special: true },
  { key: "art9_employment_social_protection", label: "Art 9: employment / social protection", special: true },
  { key: "art9_explicit_consent", label: "Art 9: explicit consent", special: true },
];

const TEXT_FIELDS: { key: TextField; help: string; multiline?: boolean; type?: string }[] = [
  { key: "controllerName", help: "The legal name of the body responsible for the data: the trust, district, local authority or school." },
  { key: "controllerAddress", help: "Postal address for privacy requests.", multiline: true },
  { key: "privacyEmail", help: "Where people send access, correction and deletion requests.", type: "email" },
  { key: "dpoName", help: "Required for public authorities, including state schools (GDPR Art 37)." },
  { key: "dpoEmail", help: "The data protection officer's contact address.", type: "email" },
  { key: "supervisoryAuthorityName", help: "For example the ICO (UK), the CNIL (France) or your country's data protection authority." },
  { key: "supervisoryAuthorityUrl", help: "The authority's website, where people can complain.", type: "url" },
  { key: "dataLocation", help: "In words: for example \"EU (Frankfurt, Germany)\". Must match your hosting, database and backup regions." },
];

function toForm(s: PrivacySettings): Form {
  return {
    controllerName: s.controllerName ?? "",
    controllerAddress: s.controllerAddress ?? "",
    privacyEmail: s.privacyEmail ?? "",
    dpoName: s.dpoName ?? "",
    dpoEmail: s.dpoEmail ?? "",
    supervisoryAuthorityName: s.supervisoryAuthorityName ?? "",
    supervisoryAuthorityUrl: s.supervisoryAuthorityUrl ?? "",
    dataLocation: s.dataLocation ?? "",
    lawfulBases: s.lawfulBases ?? {},
    additionalRecipients: (s.additionalRecipients ?? []).map((r) => ({
      name: r.name,
      purpose: r.purpose,
      location: r.location ?? "",
    })),
  };
}

export default function OrganisationPrivacyPage() {
  useSignals();
  const settingsSignal = useSignal<PrivacySettings | null>(null);
  const formSignal = useSignal<Form | null>(null);
  const noticeSignal = useSignal<PrivacyNotice | null>(null);
  const savingSignal = useSignal(false);
  const loadFailedSignal = useSignal(false);

  useEffect(() => {
    api<PrivacySettings>("/organisation/privacy")
      .then((s) => {
        settingsSignal.value = s;
        formSignal.value = toForm(s);
      })
      .catch((err) => {
        loadFailedSignal.value = true;
        toast.error(userMessage(err, "Failed to load the privacy settings"));
      });
    fetchPrivacyNotice()
      .then((n) => (noticeSignal.value = n))
      .catch(() => undefined);
  }, [settingsSignal, formSignal, noticeSignal, loadFailedSignal]);

  const settings = settingsSignal.value;
  const form = formSignal.value;
  const notice = noticeSignal.value;
  const saving = savingSignal.value;

  function setField(key: TextField, value: string) {
    if (!form) return;
    formSignal.value = { ...form, [key]: value };
  }

  function toggleBasis(purpose: string, basis: string, defaults: string[], on: boolean) {
    if (!form) return;
    const current = form.lawfulBases[purpose] ?? defaults;
    const next = on ? [...new Set([...current, basis])] : current.filter((b) => b !== basis);
    formSignal.value = { ...form, lawfulBases: { ...form.lawfulBases, [purpose]: next } };
  }

  function setRecipient(i: number, key: "name" | "purpose" | "location", value: string) {
    if (!form) return;
    const list = form.additionalRecipients.map((r, j) => (j === i ? { ...r, [key]: value } : r));
    formSignal.value = { ...form, additionalRecipients: list };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const incomplete = form.additionalRecipients.some((r) => !r.name.trim() || !r.purpose.trim());
    if (incomplete) {
      toast.error("Each added recipient needs a name and a purpose");
      return;
    }
    savingSignal.value = true;
    try {
      const body = {
        ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, form[f.key].trim() || null])),
        lawfulBases: form.lawfulBases,
        additionalRecipients: form.additionalRecipients.map((r) => ({
          name: r.name.trim(),
          purpose: r.purpose.trim(),
          location: r.location.trim() || null,
        })),
      };
      const saved = await api<PrivacySettings>("/organisation/privacy", { method: "PUT", body });
      settingsSignal.value = saved;
      formSignal.value = toForm(saved);
      fetchPrivacyNotice()
        .then((n) => (noticeSignal.value = n))
        .catch(() => undefined);
      toast.success("Privacy notice details saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the privacy settings"));
    } finally {
      savingSignal.value = false;
    }
  }

  const missing = settings?.missing ?? [];

  return (
    <div className="space-y-6">
      <OrgHeader
        title="Privacy"
        description="The details your public privacy notice shows. Your organisation is the controller of the data in this GradeBook."
        action={
          <Button variant="outline" nativeButton={false} render={<Link href="/privacy" target="_blank" />}>
            <ExternalLink className="mr-2 size-4" />
            View notice
          </Button>
        }
      />

      {settings && missing.length > 0 && (
        <Alert className="border-amber-500/50">
          <AlertTriangle className="text-amber-600" />
          <AlertTitle>Your privacy notice is incomplete</AlertTitle>
          <AlertDescription>
            Everyone who opens the notice sees that it is incomplete until you fill in:{" "}
            {missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      {!form ? (
        loadFailedSignal.value ? null : <Skeleton className="h-96" />
      ) : (
        <form onSubmit={save} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Controller and contacts</CardTitle>
              <CardDescription>Who is responsible, and how people reach you and the supervisory authority.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.multiline ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                  <Label htmlFor={`privacy-${f.key}`}>
                    {FIELD_LABELS[f.key]}
                    {missing.includes(f.key) && <span className="ml-1 text-amber-600">(required)</span>}
                  </Label>
                  {f.multiline ? (
                    <Textarea
                      id={`privacy-${f.key}`}
                      value={form[f.key]}
                      maxLength={500}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={`privacy-${f.key}`}
                      type={f.type ?? "text"}
                      value={form[f.key]}
                      maxLength={f.key === "supervisoryAuthorityUrl" ? 500 : 254}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lawful bases</CardTitle>
              <CardDescription>
                The defaults suit most state schools. An independent school usually relies on legitimate interests instead of
                public task. Use consent only where people can genuinely say no.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(notice?.lawfulBases ?? []).map((p) => {
                // The saved choice (or the default) until changed here.
                const current = p.bases.map((b) => b.key);
                const chosen = form.lawfulBases[p.purpose] ?? current;
                return (
                  <fieldset key={p.purpose} className="rounded-lg border p-3">
                    <legend className="px-1 text-sm font-medium">{p.label}</legend>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                      {BASES.map((b) => {
                        const id = `basis-${p.purpose}-${b.key}`;
                        return (
                          <div key={b.key} className="flex items-center gap-1.5">
                            <Checkbox
                              id={id}
                              checked={chosen.includes(b.key)}
                              onCheckedChange={(v) => toggleBasis(p.purpose, b.key, current, v === true)}
                            />
                            <Label htmlFor={id} className={b.special ? "text-xs text-muted-foreground" : "text-xs"}>
                              {b.label}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              {!notice && <Skeleton className="h-40" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>
                The notice lists the services this installation is configured to use. Add the ones GradeBook cannot see
                itself: your server or cloud host, a managed database, a CDN or proxy in front of the API.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {(notice?.recipients ?? [])
                  .filter((r) => r.category !== "hosting")
                  .map((r, i) => (
                    <li key={i} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{r.name}</span>
                      {" · "}
                      {CATEGORY_LABELS[r.category]}
                      {r.host ? ` · ${r.host}` : r.internal ? " · own network" : ""}
                    </li>
                  ))}
                {notice && notice.recipients.filter((r) => r.category !== "hosting").length === 0 && (
                  <li className="text-muted-foreground">No external services detected.</li>
                )}
              </ul>

              {form.additionalRecipients.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
                  <Input
                    aria-label="Recipient name"
                    placeholder="Name (e.g. Hetzner Online GmbH)"
                    value={r.name}
                    maxLength={200}
                    onChange={(e) => setRecipient(i, "name", e.target.value)}
                  />
                  <Input
                    aria-label="Purpose"
                    placeholder="What for (e.g. server hosting)"
                    value={r.purpose}
                    maxLength={500}
                    onChange={(e) => setRecipient(i, "purpose", e.target.value)}
                  />
                  <Input
                    aria-label="Location"
                    placeholder="Where (e.g. Germany)"
                    value={r.location}
                    maxLength={200}
                    onChange={(e) => setRecipient(i, "location", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove recipient"
                    onClick={() =>
                      (formSignal.value = {
                        ...form,
                        additionalRecipients: form.additionalRecipients.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={form.additionalRecipients.length >= 30}
                onClick={() =>
                  (formSignal.value = {
                    ...form,
                    additionalRecipients: [...form.additionalRecipients, { name: "", purpose: "", location: "" }],
                  })
                }
              >
                <Plus className="mr-2 size-4" />
                Add a recipient
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Retention</CardTitle>
              <CardDescription>
                Set on the server with environment variables (see the deployment guide); shown here as the notice states them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {(notice?.retention ?? []).map((r) => (
                  <li key={r.key} className="text-muted-foreground">
                    <span className="font-medium text-foreground">{r.label}:</span> {r.period}
                    {r.env && <code className="ml-1 text-xs">({r.env})</code>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
