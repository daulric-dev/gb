import { Badge } from "@/components/ui/Badge";
import { useTheme } from "@/theme/ThemeProvider";
import { draftStatusLabel } from "@/lib/sync-queue";
import { useDraft } from "./OfflineReads";

/**
 * A work row's offline state: "Saved offline", "Syncing", "Synced" or
 * "Needs attention". Nothing when there is no draft on this device.
 */
export function DraftBadge({ activityId }: { activityId: string }) {
  const { colors } = useTheme();
  const draft = useDraft(activityId);
  const label = draftStatusLabel(draft);
  if (!draft || !label || draft.state === "synced") return null;
  return (
    <Badge
      variant="outline"
      color={draft.state === "needs_attention" ? colors.destructive : undefined}
    >
      {label}
    </Badge>
  );
}
