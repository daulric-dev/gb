"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { History, Loader2 } from "lucide-react";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_PAGE,
  integrationAuditActor,
  integrationAuditChanges,
  listIntegrationAudit,
  type IntegrationAuditEntry,
} from "@/lib/webhooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { when } from "./status-badge";
import { userMessage } from "@/lib/errors";

const VIA: Record<IntegrationAuditEntry["actorVia"], string> = {
  school_admin: "School admin",
  organisation_admin: "Organisation admin",
  system: "Automatic",
};

/**
 * Activity: every change to the school's webhooks, every test and
 * redelivery, and automatic switch-offs - newest first. Never the secret.
 */
export function IntegrationActivity({ apiBase, refreshKey = 0 }: { apiBase?: string; refreshKey?: number }) {
  useSignals();
  const entries = useSignal<IntegrationAuditEntry[] | null>(null);
  const more = useSignal(false);
  const loadingMore = useSignal(false);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    let live = true;
    listIntegrationAudit(apiBase)
      .then((page) => {
        if (!live) return;
        entries.value = page;
        more.value = page.length === AUDIT_PAGE;
        error.value = null;
      })
      .catch((err) => {
        if (!live) return;
        entries.value = [];
        error.value = userMessage(err, "Failed to load activity");
      });
    return () => {
      live = false;
    };
  }, [apiBase, refreshKey, entries, more, error]);

  const loadMore = useCallback(async () => {
    const last = entries.value?.at(-1);
    if (!last) return;
    loadingMore.value = true;
    try {
      const page = await listIntegrationAudit(apiBase, last.id);
      entries.value = [...(entries.value ?? []), ...page];
      more.value = page.length === AUDIT_PAGE;
    } catch (err) {
      error.value = userMessage(err, "Failed to load activity");
    } finally {
      loadingMore.value = false;
    }
  }, [apiBase, entries, more, error, loadingMore]);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-medium">Activity</h3>
        <p className="text-sm text-muted-foreground">
          Every change to these webhooks, tests and redeliveries.
        </p>
      </div>
      {entries.value === null ? (
        <Skeleton className="h-16 w-full" />
      ) : entries.value.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <History className="size-4 shrink-0" />
          {error.value ?? "No changes yet."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.value.map((e) => {
                const changes = integrationAuditChanges(e);
                return (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(e.createdAt)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{AUDIT_ACTION_LABEL[e.action] ?? e.action}</span>
                        {e.webhook && <Badge variant="outline">{e.webhook}</Badge>}
                      </div>
                      {changes.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs break-all text-muted-foreground">
                          {changes.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{integrationAuditActor(e)}</p>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      <div>{integrationAuditActor(e)}</div>
                      <div className="text-xs text-muted-foreground">{VIA[e.actorVia]}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {more.value && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore.value}>
            {loadingMore.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
