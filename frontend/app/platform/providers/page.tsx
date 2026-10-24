"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/billing";
import type { PlatformProvider } from "@/lib/billing-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlatformHeader } from "../_components/platform-header";

function unavailableReason(p: PlatformProvider): string | null {
  if (!p.allowedByEnv) return "Not listed in PAYMENT_PROVIDERS on the server.";
  if (!p.configured) return "Its credentials are not set on the server.";
  return null;
}

export default function PlatformProvidersPage() {
  const [providers, setProviders] = useState<PlatformProvider[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PlatformProvider[]>("/platform/providers")
      .then((data) => setProviders(Array.isArray(data) ? data : []))
      .catch((err) => {
        setProviders([]);
        toast.error(errorMessage(err, "Failed to load providers"));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(p: PlatformProvider, enabled: boolean) {
    setSaving(p.id);
    setProviders((list) =>
      list?.map((x) => (x.id === p.id ? { ...x, enabled } : x)) ?? list,
    );
    try {
      await api(`/platform/providers/${p.id}`, {
        method: "PATCH",
        body: { enabled },
      });
      toast.success(`${p.label} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(errorMessage(err, `Failed to update ${p.label}`));
    } finally {
      setSaving(null);
      load();
    }
  }

  return (
    <div className="space-y-6">
      <PlatformHeader
        title="Payment providers"
        description="Which providers schools may choose at checkout"
      />
      <p className="text-sm text-muted-foreground">
        A provider is offered when the server allows it (PAYMENT_PROVIDERS),
        its credentials are configured, and it is switched on here.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {providers === null
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : providers.map((p) => {
              const reason = unavailableReason(p);
              const toggleEl = (
                <Switch
                  checked={p.enabled && !reason}
                  disabled={!!reason || saving === p.id}
                  onCheckedChange={(v) => toggle(p, v)}
                  aria-label={`Offer ${p.label}`}
                />
              );
              return (
                <Card key={p.id}>
                  <CardContent className="flex items-start gap-4 p-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{p.label}</p>
                        <Badge variant="outline" className="capitalize">
                          {p.mode}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={p.allowedByEnv ? "secondary" : "destructive"}>
                          {p.allowedByEnv ? "Allowed by env" : "Not allowed by env"}
                        </Badge>
                        <Badge variant={p.configured ? "secondary" : "destructive"}>
                          {p.configured ? "Configured" : "Not configured"}
                        </Badge>
                      </div>
                    </div>
                    {reason ? (
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          {toggleEl}
                        </TooltipTrigger>
                        <TooltipContent>{reason}</TooltipContent>
                      </Tooltip>
                    ) : (
                      toggleEl
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </div>
    </div>
  );
}
