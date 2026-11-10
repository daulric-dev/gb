"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { api, apiQuery } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { userMessage } from "@/lib/errors";
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

function revertReason(item: AuditEntry): string | null {
  if (
    item.entity !== "term" &&
    item.entity !== "academic_year"
  ) {
    return "Reverting this record type is not supported yet.";
  }
  if (item.action === "create") {
    const requiredFields =
      item.entity === "term"
        ? ["academic_year_id", "name", "start_date", "end_date", "sort_order"]
        : ["name", "start_date", "end_date", "is_active"];
    if (requiredFields.some((field) => !(field in item.changes))) {
      return "This entry does not contain a complete record snapshot.";
    }
    return null;
  }
  if (item.action !== "update") {
    return "The audit entry does not contain enough information to restore a deleted record.";
  }
  const fields = Object.keys(item.changes);
  if (
    item.entity === "academic_year" &&
    fields.includes("is_active")
  ) {
    return "Change the active academic year explicitly instead.";
  }
  const allowedFields =
    item.entity === "term"
      ? new Set(["name", "start_date", "end_date", "sort_order"])
      : new Set(["name", "start_date", "end_date"]);
  if (fields.length === 0 || fields.some((field) => !allowedFields.has(field))) {
    return "This entry contains fields that cannot be reverted safely.";
  }
  return null;
}

export function AuditLogView({
  endpoint,
  allowRevert = false,
}: {
  endpoint: string;
  allowRevert?: boolean;
}) {
  useSignals();
  const items = useSignal<AuditEntry[]>([]);
  const cursor = useSignal<string | null>(null);
  const loading = useSignal(true);
  const loadingMore = useSignal(false);
  const pendingRevert = useSignal<AuditEntry | null>(null);
  const reverting = useSignal(false);

  const load = useCallback(
    async (before?: string) => {
      const page = await apiQuery<AuditPage>(endpoint, {
        limit: 50,
        ...(before ? { before } : {}),
      });
      items.value = before ? [...items.value, ...page.items] : page.items;
      cursor.value = page.nextCursor;
    },
    [endpoint, items, cursor],
  );

  useEffect(() => {
    let active = true;
    apiQuery<AuditPage>(endpoint, { limit: 50 })
      .then((page) => {
        if (!active) return;
        items.value = page.items;
        cursor.value = page.nextCursor;
      })
      .catch((error: unknown) => {
        if (active) toast.error(userMessage(error, "Failed to load audit log"));
      })
      .finally(() => {
        if (active) loading.value = false;
      });
    return () => {
      active = false;
    };
  }, [endpoint, items, cursor, loading]);

  async function loadMore() {
    if (!cursor.value) return;
    loadingMore.value = true;
    try {
      await load(cursor.value);
    } catch (error) {
      toast.error(userMessage(error, "Failed to load more audit entries"));
    } finally {
      loadingMore.value = false;
    }
  }

  async function confirmRevert() {
    if (!pendingRevert.value) return;
    reverting.value = true;
    try {
      await api(`/organisation/audit-log/${pendingRevert.value.id}/revert`, {
        method: "POST",
      });
      toast.success("Revert completed and recorded in the audit log");
      pendingRevert.value = null;
      cursor.value = null;
      await load();
    } catch (error) {
      toast.error(userMessage(error, "Failed to revert this audit entry"));
    } finally {
      reverting.value = false;
    }
  }

  if (loading.value) {
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
      {items.value.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No changes have been recorded yet.
          </CardContent>
        </Card>
      ) : (
        items.value.map((item) => (
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
                {allowRevert && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!revertReason(item)}
                    title={revertReason(item) ?? undefined}
                    onClick={() => (pendingRevert.value = item)}
                  >
                    Revert
                  </Button>
                )}
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
      {cursor.value && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore.value}>
            {loadingMore.value ? "Loading…" : "Load older changes"}
          </Button>
        </div>
      )}
      {allowRevert && (
        <AlertDialog
          open={pendingRevert.value !== null}
          onOpenChange={(open) => {
            if (!open && !reverting.value) pendingRevert.value = null;
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revert this change?</AlertDialogTitle>
              <AlertDialogDescription>
                This is a dangerous action. It will change or remove the
                affected record, and the revert itself will be recorded as a
                new audit entry. Only organisation admins can perform reverts.
                If the record has changed since this entry, or cannot be
                safely restored, the request will be rejected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={reverting.value}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={confirmRevert}
                disabled={reverting.value}
              >
                {reverting.value ? "Reverting…" : "Revert change"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
