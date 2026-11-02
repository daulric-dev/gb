"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, Loader2, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import {
  DELIVERY_PAGE,
  deliveryStatusText,
  getDelivery,
  listDeliveries,
  webhooksApi,
  type DeliveryStatus,
  type EventTypeCatalog,
  type WebhookDelivery,
  type WebhookDeliveryDetail,
} from "@/lib/webhooks";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeliveryStatusBadge, when } from "./status-badge";
import { userMessage } from "@/lib/errors";

/**
 * One webhook's deliveries, newest first, filtered by status and event type:
 * status, event, time, HTTP status, duration. A row opens the payload, the
 * receiver's response and the attempts, with Redeliver.
 */
export function WebhookDeliveries({
  apiBase,
  webhookId,
  catalog,
  refreshKey = 0,
  onChangedAction,
}: {
  apiBase?: string;
  webhookId: string;
  catalog: EventTypeCatalog | null;
  refreshKey?: number;
  onChangedAction: () => void;
}) {
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [eventType, setEventType] = useState("");
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDeliveries(apiBase, webhookId, { status, eventType })
      .then((page) => {
        if (!live) return;
        setRows(page);
        setMore(page.length === DELIVERY_PAGE);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setRows([]);
        setError(userMessage(err, "Failed to load deliveries"));
      });
    return () => {
      live = false;
    };
  }, [apiBase, webhookId, status, eventType, refreshKey]);

  const loadMore = useCallback(async () => {
    const last = rows?.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await listDeliveries(apiBase, webhookId, { status, eventType, before: last.id });
      setRows((list) => [...(list ?? []), ...page]);
      setMore(page.length === DELIVERY_PAGE);
    } catch (err) {
      setError(userMessage(err, "Failed to load deliveries"));
    } finally {
      setLoadingMore(false);
    }
  }, [apiBase, webhookId, status, eventType, rows]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-auto text-sm font-medium">Deliveries</h4>
        <NativeSelect
          size="sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as DeliveryStatus | "")}
          aria-label="Filter by status"
        >
          <NativeSelectOption value="">Any status</NativeSelectOption>
          <NativeSelectOption value="succeeded">Delivered</NativeSelectOption>
          <NativeSelectOption value="pending">Retrying</NativeSelectOption>
          <NativeSelectOption value="failed">Failed</NativeSelectOption>
          <NativeSelectOption value="abandoned">Gave up</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          size="sm"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          aria-label="Filter by event"
        >
          <NativeSelectOption value="">Any event</NativeSelectOption>
          {catalog?.eventTypes.map((t) => (
            <NativeSelectOption key={t.key} value={t.key}>
              {t.key}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {rows === null ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Inbox className="size-4 shrink-0" />
          {error ?? "No deliveries yet."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="hidden sm:table-cell">When</TableHead>
                <TableHead className="hidden md:table-cell">HTTP</TableHead>
                <TableHead className="hidden md:table-cell">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setOpenId(d.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(d.id)}
                >
                  <TableCell>
                    <DeliveryStatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    {when(d.createdAt)}
                  </TableCell>
                  <TableCell className="hidden text-xs md:table-cell">{d.lastStatusCode ?? "—"}</TableCell>
                  <TableCell className="hidden text-xs md:table-cell">
                    {d.durationMs === null ? "—" : `${d.durationMs} ms`}
                  </TableCell>
                </TableRow>
              ))}
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

      <DeliveryDialog
        key={openId ?? "closed"}
        apiBase={apiBase}
        deliveryId={openId}
        onCloseAction={() => setOpenId(null)}
        onRedeliveredAction={onChangedAction}
      />
    </div>
  );
}

function DeliveryDialog({
  apiBase,
  deliveryId,
  onCloseAction,
  onRedeliveredAction,
}: {
  apiBase?: string;
  deliveryId: string | null;
  onCloseAction: () => void;
  onRedeliveredAction: () => void;
}) {
  const [detail, setDetail] = useState<WebhookDeliveryDetail | null>(null);
  const [sending, setSending] = useState(false);

  // Remounted per delivery (key), so it starts empty.
  useEffect(() => {
    if (!deliveryId) return;
    getDelivery(apiBase, deliveryId)
      .then(setDetail)
      .catch((err) => toast.error(userMessage(err, "Failed to load the delivery")));
  }, [apiBase, deliveryId]);

  async function redeliver() {
    if (!detail) return;
    setSending(true);
    try {
      const sent = await api<WebhookDeliveryDetail>(
        `${webhooksApi(apiBase)}/deliveries/${detail.id}/redeliver`,
        { method: "POST" },
      );
      if (sent.status === "succeeded") toast.success("Delivered");
      else toast.error(`Not delivered: ${sent.lastError ?? "the receiver did not accept it"}`);
      setDetail(sent);
      onRedeliveredAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to send it again"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!deliveryId} onOpenChange={(open) => !open && onCloseAction()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{detail?.eventType ?? "Delivery"}</DialogTitle>
          <DialogDescription>
            {detail
              ? `${deliveryStatusText(detail)} · created ${when(detail.createdAt)}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {detail && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="font-mono break-all">{detail.id}</dd>
              <dt className="text-muted-foreground">Event id</dt>
              <dd className="font-mono break-all">{detail.eventId}</dd>
              <dt className="text-muted-foreground">Attempts</dt>
              <dd>
                {detail.attempts} of {detail.maxAttempts}
              </dd>
              {detail.nextAttemptAt && (
                <>
                  <dt className="text-muted-foreground">Next attempt</dt>
                  <dd>{when(detail.nextAttemptAt)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">HTTP status</dt>
              <dd>{detail.lastStatusCode ?? "—"}</dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{detail.durationMs === null ? "—" : `${detail.durationMs} ms`}</dd>
              {detail.lastError && (
                <>
                  <dt className="text-muted-foreground">Error</dt>
                  <dd className="text-destructive">{detail.lastError}</dd>
                </>
              )}
            </dl>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Payload</p>
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/50 p-2 text-xs">
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Response (first 1 KB)</p>
              <pre className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                {detail.responseExcerpt ?? "(empty)"}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={redeliver} disabled={!detail || sending}>
            {sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RotateCw className="mr-2 size-4" />}
            Redeliver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
