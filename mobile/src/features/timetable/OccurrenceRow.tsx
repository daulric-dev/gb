import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import {
  occurrenceDetail,
  statusLabel,
  timeRange,
  type TimetableOccurrence,
} from "@/lib/timetable";

/** One period: time, course, period / room, and a cancelled or moved badge. */
export function OccurrenceRow({
  occurrence: o,
  right,
  children,
}: {
  occurrence: TimetableOccurrence;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const cancelled = o.status === "cancelled";
  const status = statusLabel(o);
  const label = [
    timeRange(o),
    o.courseName,
    occurrenceDetail(o),
    status,
    o.note,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      accessible={!children && !right}
      accessibilityLabel={label}
      style={[styles.row, { borderColor: colors.border, opacity: cancelled ? 0.7 : 1 }]}
    >
      <View style={styles.time}>
        <Text weight="600" size="sm">
          {timeRange(o)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          weight="500"
          numberOfLines={1}
          style={cancelled ? { textDecorationLine: "line-through" } : undefined}
        >
          {o.courseName}
        </Text>
        <Text variant="muted" size="xs" numberOfLines={1}>
          {occurrenceDetail(o) || "Period"}
        </Text>
        {status || o.note ? (
          <View style={styles.statusLine}>
            {status ? <Badge variant={cancelled ? "outline" : "secondary"}>{status}</Badge> : null}
            {o.note ? (
              <Text variant="muted" size="xs" numberOfLines={2} style={{ flex: 1 }}>
                {o.note}
              </Text>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  time: { minWidth: 92 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
});
