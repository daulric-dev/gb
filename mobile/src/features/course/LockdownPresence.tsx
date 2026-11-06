import { View } from "react-native";
import { CalendarClock, RefreshCw, ShieldCheck } from "lucide-react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { useTheme } from "@/theme/ThemeProvider";
import type { StudentExtension, TeacherSubmissionRow } from "@/lib/course";

/** Same tones as the web roster (amber / emerald). */
const AWAY = "#d97706";
const TAKING = "#059669";

/** Why a student is away, in the web app's wording. */
export function awayReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "tab_hidden":
      return "Switched tab or minimised";
    case "window_blur":
      return "Left the window";
    case "fullscreen_exit":
      return "Left fullscreen";
    case "app_background":
      return "Left the app";
    case "screen_recording":
      return "Recording the screen";
    case "screenshot":
      return "Took a screenshot";
    case "unpinned":
      return "Unpinned the app";
    case "not_pinned":
      return "App not pinned";
    case "no_heartbeat":
      return "Not responding";
    default:
      return "Away";
  }
}

function timeOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One student's lockdown status on the roster: "Taking now" or "Away (why)",
 * how many times they left, and when they last did.
 */
export function LockdownPresence({
  submission,
}: {
  submission: TeacherSubmissionRow["submission"];
}) {
  if (!submission) return null;
  const switches = submission.tabSwitchCount ?? 0;
  const active = !!submission.isActiveAttempt;
  if (!active && switches === 0) return null;
  const lastAway = submission.lastAwayAt ? timeOf(submission.lastAwayAt) : null;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {active ? (
        submission.isAway ? (
          <Badge variant="outline" color={AWAY}>
            Away · {awayReasonLabel(submission.awayReason)}
          </Badge>
        ) : (
          <Badge variant="outline" color={TAKING}>
            Taking now
          </Badge>
        )
      ) : null}
      <Text
        size="xs"
        variant={switches > 0 ? "default" : "muted"}
        weight={switches > 0 ? "600" : undefined}
        style={switches > 0 ? { color: AWAY } : undefined}
      >
        Left {switches} {switches === 1 ? "time" : "times"}
        {lastAway && switches > 0 ? ` · last at ${lastAway}` : ""}
      </Text>
    </View>
  );
}

/** A line above the roster: who is in the quiz now, and a manual refresh. */
export function LockdownMonitorSummary({
  rows,
  refreshing,
  onRefresh,
}: {
  rows: TeacherSubmissionRow[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const active = rows.filter((r) => r.submission?.isActiveAttempt);
  const away = active.filter((r) => r.submission?.isAway).length;
  return (
    <Card>
      <CardContent style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
        <ShieldCheck color={colors.primary} size={16} />
        <Text size="sm" style={{ flex: 1 }}>
          Lockdown quiz ·{" "}
          {active.length === 0
            ? "No one is taking it right now"
            : `${active.length} taking now${away ? `, ${away} away` : ""}`}
          {active.length > 0 ? (
            <Text size="sm" variant="muted">
              {" "}
              · updates every 10s
            </Text>
          ) : null}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          loading={refreshing}
          onPress={onRefresh}
          icon={<RefreshCw color={colors.foreground} size={14} />}
        >
          Refresh
        </Button>
      </CardContent>
    </Card>
  );
}

/** "Extended to …" under a student's name on the roster. */
export function ExtensionBadge({
  extension,
}: {
  extension?: StudentExtension | null;
}) {
  const { colors } = useTheme();
  if (!extension) return null;
  const date = new Date(extension.dueAt);
  const label = Number.isNaN(date.getTime())
    ? "Extended"
    : `Extended to ${date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <CalendarClock color={colors.mutedForeground} size={12} />
      <Badge variant="outline">{label}</Badge>
    </View>
  );
}
