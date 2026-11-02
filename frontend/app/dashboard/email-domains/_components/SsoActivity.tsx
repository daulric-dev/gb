"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import {
  ACTION_LABEL,
  auditActor,
  auditChanges,
  auditSubject,
  listSsoAudit,
  SSO_AUDIT_PAGE,
  type SsoAuditEntry,
} from "@/lib/sso-audit";
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
import { userMessage } from "@/lib/errors";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Activity: every change to the school's single sign-on settings - who made
 * it, from which console, and what changed (certificates as fingerprints,
 * secrets only as set / cleared) - newest first, a page at a time. Part of
 * `SchoolSingleSignOn`; `refreshKey` reloads the first page after a change.
 */
export function SsoActivity({
  apiBase,
  refreshKey = 0,
}: {
  /** Default: the active school. */
  apiBase?: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<SsoAuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listSsoAudit(apiBase)
      .then((page) => {
        if (!live) return;
        setEntries(page);
        setMore(page.length === SSO_AUDIT_PAGE);
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
      const page = await listSsoAudit(apiBase, { before: last.id });
      setEntries((list) => [...(list ?? []), ...page]);
      setMore(page.length === SSO_AUDIT_PAGE);
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
          Every change to these settings. The school&apos;s admin and the
          organisation&apos;s admins are emailed about changes to where people
          sign in.
        </p>
      </div>

      {entries === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
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
                <TableHead className="w-40">When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const changes = auditChanges(e);
                return (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {when(e.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {auditSubject(e)}
                        </Badge>
                      </div>
                      {changes.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs break-all text-muted-foreground">
                          {changes.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">
                        {auditActor(e)}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      <div>{auditActor(e)}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.actorVia === "organisation_admin" ? "Organisation admin" : "School admin"}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {entries && entries.length > 0 && error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
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
