"use client";

import { useCallback, useEffect, useState } from "react";
import { apiQuery } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/errors";

type AuditChange = { before: unknown; after: unknown };
type AuditEntry = {
  id: string;
  scope: "school" | "organisation";
  schoolName: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  entity: string;
  entityId: string | null;
  action: string;
  changes: Record<string, AuditChange>;
  createdAt: string;
};
type AuditPage = { items: AuditEntry[]; nextCursor: string | null };

function showValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function actorName(actor: AuditEntry["actor"]) {
  return actor?.name || actor?.email || "Deleted account";
}

function displayField(field: string) {
  return field.replaceAll("_", " ");
}

function actionLabel(action: string) {
  if (action === "create") return "created";
  if (action === "update") return "updated";
  if (action === "delete") return "deleted";
  return action;
}

export function AuditLogView({ endpoint }: { endpoint: string }) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      const page = await apiQuery<AuditPage>(endpoint, {
        limit: 50,
        ...(before ? { before } : {}),
      });
      setItems((current) =>
        before ? [...current, ...page.items] : page.items,
      );
      setCursor(page.nextCursor);
    },
    [endpoint],
  );

  useEffect(() => {
    let active = true;
    apiQuery<AuditPage>(endpoint, { limit: 50 })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (active) toast.error(userMessage(error, "Failed to load audit log"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch (error) {
      toast.error(userMessage(error, "Failed to load more audit entries"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No changes have been recorded yet.
          </CardContent>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {actorName(item.actor)} {actionLabel(item.action)}{" "}
                    {item.entity.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.schoolName ??
                      (item.scope === "organisation" ? "Organisation" : null)}
                    {item.schoolName || item.scope === "organisation"
                      ? " · "
                      : ""}
                    {new Date(item.createdAt).toLocaleString()}
                    {item.entityId ? ` · ${item.entityId}` : ""}
                  </p>
                </div>
              </div>
              <div className="divide-y rounded-md border">
                {Object.entries(item.changes).map(([field, change]) => (
                  <div
                    key={field}
                    className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(8rem,0.35fr)_1fr]"
                  >
                    <span className="font-medium capitalize">
                      {displayField(field)}
                    </span>
                    <span className="min-w-0 wrap-break-word text-muted-foreground">
                      <span>{showValue(change.before)}</span>
                      <span className="px-2 text-foreground">→</span>
                      <span className="text-foreground">
                        {showValue(change.after)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
