import { Badge } from "@/components/ui/badge";
import { DELIVERY_STATUS, type DeliveryStatus } from "@/lib/webhooks";

const TONE: Record<string, string | undefined> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: undefined,
  off: undefined,
};

/** A delivery's status as a coloured badge. */
export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const s = DELIVERY_STATUS[status];
  return (
    <Badge variant={s.tone === "bad" ? "destructive" : "secondary"} className={TONE[s.tone]}>
      {s.label}
    </Badge>
  );
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
