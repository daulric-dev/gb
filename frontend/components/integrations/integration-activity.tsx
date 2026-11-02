"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [entries, setEntries] = useState<IntegrationAuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listIntegrationAudit(apiBase)
      .then((page) => {
        if (!live) return;
        setEntries(page);
        setMore(page.length === AUDIT_PAGE);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setEntries([]);
        setError(userMessage(err, "Failed to load activity"));
      });
    return () => {
      live = false;
    };
  }, [apiBase, refreshKey]);

  const loadMore = useCallback(async () => {
    const last = entries?.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await listIntegrationAudit(apiBase, last.id);
      setEntries((list) => [...(list ?? []), ...page]);
      setMore(page.length === AUDIT_PAGE);
    } catch (err) {
      setError(userMessage(err, "Failed to load activity"));
    } finally {
      setLoadingMore(false);
    }
  }, [apiBase, entries]);

  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-medium">Activity</h3>
        <p className="text-sm text-muted-foreground">
          Every change to these webhooks, tests and redeliveries.
        </p>
      </div>
      {entries === null ? (
        <Skeleton className="h-16 w-full" />
      ) : entries.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <History className="size-4 shrink-0" />
          {error ?? "No changes yet."}
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
              {entries.map((e) => {
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
      {more && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 size-4 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
