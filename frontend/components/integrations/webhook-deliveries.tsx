"use client";

import { Fragment, useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Inbox, Loader2, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import {
  DELIVERY_PAGE,
  deliveryHeaders,
  deliveryStatusText,
  getDelivery,
  listDeliveries,
  payloadMessage,
  payloadSchoolId,
  webhooksApi,
  type DeliveryStatus,
  type EventTypeCatalog,
  type WebhookDelivery,
  type WebhookDeliveryDetail,
} from "@/lib/webhooks";
import { Badge } from "@/components/ui/badge";
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

const LIVE_REFRESH_MS = 2_000;

/**
 * One webhook's deliveries, newest first, filtered by status and event type:
 * status, event, time, HTTP status, duration. The list refreshes while the
 * webhook is expanded; a row opens the payload, response and attempts.
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
  useSignals();
  const status = useSignal<DeliveryStatus | "">("");
  const eventType = useSignal("");
  const rows = useSignal<WebhookDelivery[] | null>(null);
  const more = useSignal(false);
  const loadingMore = useSignal(false);
  const error = useSignal<string | null>(null);
  const openId = useSignal<string | null>(null);
  const statusValue = status.value;
  const eventTypeValue = eventType.value;

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refreshRows = async () => {
      try {
        const page = await listDeliveries(
          apiBase,
          webhookId,
          { status: statusValue, eventType: eventTypeValue },
          controller.signal,
        );
        if (!live) return;
        const current = rows.value;
        if (!current) {
          rows.value = page;
        } else {
          const currentPageIds = new Set(page.map((delivery) => delivery.id));
          rows.value = [
            ...page,
            ...current.filter((delivery) => !currentPageIds.has(delivery.id)),
          ];
        }
        more.value = page.length === DELIVERY_PAGE;
        error.value = null;
      } catch (err) {
        if (!live) return;
        rows.value = rows.value ?? [];
        error.value = userMessage(err, "Failed to load deliveries");
      } finally {
        if (live) timer = setTimeout(() => void refreshRows(), LIVE_REFRESH_MS);
      }
    };

    void refreshRows();
    return () => {
      live = false;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [apiBase, webhookId, statusValue, eventTypeValue, refreshKey, rows, more, error]);

  const loadMore = useCallback(async () => {
    const last = rows.value?.at(-1);
    if (!last) return;
    loadingMore.value = true;
    try {
      const page = await listDeliveries(apiBase, webhookId, {
        status: status.value,
        eventType: eventType.value,
        before: last.id,
      });
      rows.value = [...(rows.value ?? []), ...page];
      more.value = page.length === DELIVERY_PAGE;
    } catch (err) {
      error.value = userMessage(err, "Failed to load deliveries");
    } finally {
      loadingMore.value = false;
    }
  }, [apiBase, webhookId, status, eventType, rows, more, error, loadingMore]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-auto text-sm font-medium">Deliveries</h4>
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          title="Updates while this webhook is expanded"
          aria-label="Live delivery updates"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          Live
        </span>
        <NativeSelect
          size="sm"
          value={status.value}
          onChange={(e) => (status.value = e.target.value as DeliveryStatus | "")}
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
          value={eventType.value}
          onChange={(e) => (eventType.value = e.target.value)}
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

      {rows.value === null ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.value.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Inbox className="size-4 shrink-0" />
          {error.value ?? "No deliveries yet."}
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
              {rows.value.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => (openId.value = d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openId.value = d.id;
                  }}
                >
                  <TableCell>
                    <DeliveryStatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {d.eventType}
                    {d.tlsVerified === false && (
                      <Badge variant="destructive" className="ml-2 font-sans" title="Sent without checking the certificate">
                        TLS not verified
                      </Badge>
                    )}
                  </TableCell>
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
      {more.value && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore.value}>
            {loadingMore.value && <Loader2 className="mr-2 size-4 animate-spin" />}
            Load more
          </Button>
        </div>
      )}

      <DeliveryDialog
        key={openId.value ?? "closed"}
        apiBase={apiBase}
        deliveryId={openId.value}
        onCloseAction={() => (openId.value = null)}
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
  useSignals();
  const detail = useSignal<WebhookDeliveryDetail | null>(null);
  const sending = useSignal(false);

  // Remounted per delivery (key), so it starts empty.
  useEffect(() => {
    if (!deliveryId) return;
    getDelivery(apiBase, deliveryId)
      .then((d) => {
        detail.value = d;
      })
      .catch((err) => toast.error(userMessage(err, "Failed to load the delivery")));
  }, [apiBase, deliveryId, detail]);

  async function redeliver() {
    if (!detail.value) return;
    sending.value = true;
    try {
      const sent = await api<WebhookDeliveryDetail>(
        `${webhooksApi(apiBase)}/deliveries/${detail.value.id}/redeliver`,
        { method: "POST" },
      );
      if (sent.status === "succeeded") toast.success("Delivered");
      else toast.error(`Not delivered: ${sent.lastError ?? "the receiver did not accept it"}`);
      detail.value = sent;
      onRedeliveredAction();
    } catch (err) {
      toast.error(userMessage(err, "Failed to send it again"));
    } finally {
      sending.value = false;
    }
  }

  return (
    <Dialog open={!!deliveryId} onOpenChange={(open) => !open && onCloseAction()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{detail.value?.eventType ?? "Delivery"}</DialogTitle>
          <DialogDescription>
            {detail.value
              ? `${deliveryStatusText(detail.value)} · created ${when(detail.value.createdAt)}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {detail.value && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="font-mono break-all">{detail.value.id}</dd>
              <dt className="text-muted-foreground">Event id</dt>
              <dd className="font-mono break-all">{detail.value.eventId}</dd>
              <dt className="text-muted-foreground">Attempts</dt>
              <dd>
                {detail.value.attempts} of {detail.value.maxAttempts}
              </dd>
              {detail.value.nextAttemptAt && (
                <>
                  <dt className="text-muted-foreground">Next attempt</dt>
                  <dd>{when(detail.value.nextAttemptAt)}</dd>
                </>
              )}
              {detail.value.tlsVerified === false && (
                <>
                  <dt className="text-muted-foreground">TLS</dt>
                  <dd className="text-destructive">Sent without verifying the certificate</dd>
                </>
              )}
              <dt className="text-muted-foreground">HTTP status</dt>
              <dd>{detail.value.lastStatusCode ?? "—"}</dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{detail.value.durationMs === null ? "—" : `${detail.value.durationMs} ms`}</dd>
              {detail.value.lastError && (
                <>
                  <dt className="text-muted-foreground">Error</dt>
                  <dd className="text-destructive">{detail.value.lastError}</dd>
                </>
              )}
            </dl>
            {payloadMessage(detail.value.payload) && (
              <p className="rounded-md border bg-muted/30 p-2 text-sm">{payloadMessage(detail.value.payload)}</p>
            )}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Headers (besides signature and timestamp)</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/50 p-2 font-mono text-xs">
                {deliveryHeaders(detail.value, payloadSchoolId(detail.value.payload)).map(([name, value]) => (
                  <Fragment key={name}>
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="break-all">{value}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Body (<code>event_type</code>, <code>message</code>, <code>data</code>)
              </p>
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/50 p-2 text-xs">
                {JSON.stringify(detail.value.payload, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Response (first 1 KB)</p>
              <pre className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                {detail.value.responseExcerpt ?? "(empty)"}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={redeliver} disabled={!detail.value || sending.value}>
            {sending.value ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RotateCw className="mr-2 size-4" />}
            Redeliver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
