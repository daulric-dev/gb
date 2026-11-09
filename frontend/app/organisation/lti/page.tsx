"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import {
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Puzzle,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import {
  ORGANISATION_LTI_API,
  deploymentLabel,
  ltiToolApi,
  type LtiOverview,
  type LtiPlatform,
  type LtiTool,
} from "@/lib/lti";
import { listOrganisationSchools, type OrganisationSchool } from "@/lib/organisation";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { CopyRow } from "@/app/dashboard/email-domains/_components/CopyRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { OrgHeader } from "../_components/org-header";
import { ToolFormDialog } from "./_components/tool-form-dialog";

/**
 * External tools (LTI 1.3): the values a tool is configured with, the tool
 * registry, each tool's deployments (schools), and the platform signing key.
 * Every change asks "Confirm it's you" (step-up).
 */
export default function OrganisationLtiPage() {
  useSignals();
  const data = useSignal<LtiOverview | null>(null);
  const off = useSignal(false);
  const schools = useSignal<OrganisationSchool[] | null>(null);
  const editing = useSignal<LtiTool | null>(null);
  const formOpen = useSignal(false);
  const formKey = useSignal(0);
  const rotating = useSignal(false);
  const refresh = useSignal(0);
  const bump = useCallback(() => (refresh.value = refresh.value + 1), [refresh]);

  useEffect(() => {
    let live = true;
    api<LtiOverview>(ORGANISATION_LTI_API)
      .then((d) => {
        if (!live) return;
        data.value = d;
        off.value = false;
      })
      .catch((err) => {
        if (!live) return;
        if (isFeatureDisabledError(err)) off.value = true;
        else toast.error(userMessage(err, "Failed to load external tools"));
      });
    return () => {
      live = false;
    };
  }, [refresh.value, data, off]);

  useEffect(() => {
    listOrganisationSchools("", "all")
      .then((s) => (schools.value = s))
      .catch(() => (schools.value = []));
  }, [schools]);

  const replaceTool = (tool: LtiTool) => {
    const d = data.value;
    data.value = d
      ? {
          ...d,
          tools: d.tools.some((t) => t.id === tool.id)
            ? d.tools.map((t) => (t.id === tool.id ? tool : t))
            : [...d.tools, tool].sort((a, b) => a.name.localeCompare(b.name)),
        }
      : d;
  };

  async function rotateKey() {
    if (
      !window.confirm(
        "Rotate the platform signing key? Tools that fetch the JWKS URL pick up the new key automatically; the old one stays published for a while so launches in progress still verify.",
      )
    )
      return;
    rotating.value = true;
    try {
      const platform = await api<LtiPlatform>(`${ORGANISATION_LTI_API}/keys/rotate`, {
        method: "POST",
        stepUp: true,
      });
      const d = data.value;
      data.value = d ? { ...d, platform } : d;
      toast.success("Platform key rotated");
    } catch (err) {
      toast.error(userMessage(err, "Failed to rotate the key"));
    } finally {
      rotating.value = false;
    }
  }

  function openForm(tool: LtiTool | null) {
    editing.value = tool;
    formKey.value = formKey.value + 1;
    formOpen.value = true;
  }

  const header = (
    <OrgHeader
      title="External tools"
      description="Connect LTI 1.3 tools that teachers can add to course modules"
      action={
        data.value && (
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-1.5 size-4" />
            Register a tool
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
          External tools are turned off. Switch on &ldquo;External tools (LTI 1.3)&rdquo; under
          Features to use them.
        </p>
      </div>
    );
  }

  if (!data.value) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const { platform, tools } = data.value;
  const activeKey = platform.keys.find((k) => k.active);

  return (
    <div className="space-y-6">
      {header}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            What tools receive
          </CardTitle>
          <CardDescription>
            On each launch a tool learns your organisation&apos;s name, the course&apos;s name and
            code, the item&apos;s title, the person&apos;s role in the course (teacher or student) and
            an id for them that is different for every tool. It gets their
            name or email only if you switch that on for the tool. Tools with grade passback can
            read and write scores only for their own gradebook columns.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Values to give the tool</CardTitle>
          <CardDescription>
            The same for every tool. Each tool also needs its own client id and deployment ids,
            shown with it below.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <CopyRow label="Issuer (platform id)" value={platform.issuer} />
          <CopyRow label="Authentication request URL (OIDC auth endpoint)" value={platform.authUrl} />
          <CopyRow label="Public keyset URL (JWKS)" value={platform.jwksUrl} />
          <CopyRow label="Access token URL" value={platform.tokenUrl} />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="lti-tools-heading">
        <h2 id="lti-tools-heading" className="text-lg font-semibold">
          Tools
        </h2>
        {tools.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <Puzzle className="size-4 shrink-0" />
            No tools registered yet.
          </div>
        ) : (
          <div className="divide-y rounded-lg border px-4">
            {tools.map((t) => (
              <ToolRow
                key={t.id}
                tool={t}
                platform={platform}
                schools={schools.value}
                onEditAction={() => openForm(t)}
                onChangedAction={replaceTool}
                onRemovedAction={bump}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Platform signing key
          </CardTitle>
          <CardDescription>
            GradeBook signs launches with this key; tools check them against the JWKS URL above.
            Rotate it if you think it has been exposed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {platform.keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No key yet. One is made on the first launch.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {platform.keys.map((k) => (
                <li key={k.kid} className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs">{k.kid}</code>
                  {k.active ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Retired</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    created {new Date(k.createdAt).toLocaleDateString()}
                    {k.retiredAt && `, retired ${new Date(k.retiredAt).toLocaleDateString()}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" onClick={rotateKey} disabled={rotating.value}>
            {rotating.value ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <KeyRound className="mr-1.5 size-4" />
            )}
            {activeKey ? "Rotate key" : "Create key"}
          </Button>
        </CardContent>
      </Card>

      <ToolFormDialog
        key={formKey.value}
        open={formOpen.value}
        existing={editing.value}
        schools={schools.value}
        onOpenChangeAction={(o) => (formOpen.value = o)}
        onSavedAction={replaceTool}
      />
    </div>
  );
}

function ToolRow({
  tool: t,
  platform,
  schools,
  onEditAction,
  onChangedAction,
  onRemovedAction,
}: {
  tool: LtiTool;
  platform: LtiPlatform;
  schools: OrganisationSchool[] | null;
  onEditAction: () => void;
  onChangedAction: (tool: LtiTool) => void;
  onRemovedAction: () => void;
}) {
  useSignals();
  const open = useSignal(false);
  const busy = useSignal<string | null>(null);
  const addSchool = useSignal("");
  const base = ltiToolApi(t.id);
  const everySchool = t.deployments.some((d) => d.schoolId === null);
  const deployed = new Set(t.deployments.map((d) => d.schoolId));
  const addable = (schools ?? []).filter((s) => !deployed.has(s.id));

  async function run(label: string, fn: () => Promise<void>) {
    busy.value = label;
    try {
      await fn();
    } catch (err) {
      toast.error(userMessage(err, `Failed to ${label}`));
    } finally {
      busy.value = null;
    }
  }

  const toggle = (enabled: boolean) =>
    run(enabled ? "turn it on" : "turn it off", async () => {
      onChangedAction(
        await api<LtiTool>(base, { method: "PATCH", body: { enabled }, stepUp: true }),
      );
      toast.success(enabled ? "Tool turned on" : "Tool turned off");
    });

  const remove = () => {
    if (!window.confirm(`Delete "${t.name}"? Its client id and deployment ids stop working.`)) {
      return;
    }
    busy.value = "delete it";
    api(base, { method: "DELETE", stepUp: true })
      .then(() => {
        toast.success("Tool deleted");
        onRemovedAction();
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) {
          toast.error(
            "This tool is used in course modules. Switch it off instead, or remove those items first.",
          );
        } else {
          toast.error(userMessage(err, "Failed to delete the tool"));
        }
      })
      .finally(() => (busy.value = null));
  };

  const addDeployment = () =>
    run("add the deployment", async () => {
      const schoolId = addSchool.value === "all" ? null : addSchool.value;
      if (!addSchool.value) return;
      onChangedAction(
        await api<LtiTool>(`${base}/deployments`, {
          method: "POST",
          body: { schoolId },
          stepUp: true,
        }),
      );
      addSchool.value = "";
      toast.success("Deployment added. Give the tool its deployment id.");
    });

  const removeDeployment = (deploymentId: string, label: string) => {
    if (
      !window.confirm(
        `Remove the deployment for ${label}? Launches through it stop working.`,
      )
    ) {
      return;
    }
    void run("remove the deployment", async () => {
      onChangedAction(
        await api<LtiTool>(`${base}/deployments/${encodeURIComponent(deploymentId)}`, {
          method: "DELETE",
          stepUp: true,
        }),
      );
      toast.success("Deployment removed");
    });
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => (open.value = !open.value)}
          aria-expanded={open.value}
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !open.value && "-rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{t.name}</span>
              {t.agsEnabled && <Badge variant="outline">Grade passback</Badge>}
              {(t.sendName || t.sendEmail) && (
                <Badge variant="outline">
                  Sends {[t.sendName && "name", t.sendEmail && "email"].filter(Boolean).join(" and ")}
                </Badge>
              )}
              {!t.enabled && <Badge variant="outline">Off</Badge>}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {t.loginUrl}
            </span>
            <span className="block text-xs text-muted-foreground">
              {everySchool
                ? "Every school"
                : `${t.deployments.length} school${t.deployments.length === 1 ? "" : "s"}`}
              {" · "}
              {t.linkCount} course item{t.linkCount === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        <Switch
          checked={t.enabled}
          disabled={!!busy.value}
          onCheckedChange={(v) => void toggle(v)}
          aria-label={`Allow launches of ${t.name}`}
        />
      </div>

      {open.value && (
        <div className="mt-3 space-y-4 pl-6">
          {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEditAction}>
              <Pencil className="mr-1.5 size-3.5" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={remove}
              disabled={!!busy.value}
            >
              {busy.value === "delete it" ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" />
              )}
              Delete
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CopyRow label={`Client id for ${t.name}`} value={t.clientId} />
            <CopyRow label="Issuer" value={platform.issuer} />
            <CopyRow label="Authentication request URL" value={platform.authUrl} />
            <CopyRow label="Public keyset URL (JWKS)" value={platform.jwksUrl} />
            {t.agsEnabled && <CopyRow label="Access token URL" value={platform.tokenUrl} />}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Deployments</h3>
            <p className="text-xs text-muted-foreground">
              Give the tool every deployment id below. A school launches through its own
              deployment, else the &ldquo;every school&rdquo; one.
            </p>
            {t.deployments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deployments: no school can use this tool.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {t.deployments.map((d) => {
                  const label = deploymentLabel(d);
                  return (
                    <li key={d.id} className="flex items-end gap-2 p-2">
                      <div className="min-w-0 flex-1">
                        <CopyRow label={label} value={d.deploymentId} />
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => removeDeployment(d.id, label)}
                        disabled={!!busy.value}
                        aria-label={`Remove the deployment for ${label}`}
                        title="Remove"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={addSchool.value}
                onChange={(e) => (addSchool.value = e.target.value)}
                aria-label={`Add a deployment for ${t.name}`}
                className="min-w-48"
              >
                <NativeSelectOption value="">Add a deployment for…</NativeSelectOption>
                {!everySchool && <NativeSelectOption value="all">Every school</NativeSelectOption>}
                {addable.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void addDeployment()}
                disabled={!addSchool.value || !!busy.value}
              >
                {busy.value === "add the deployment" ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 size-3.5" />
                )}
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
