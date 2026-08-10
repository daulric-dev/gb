import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Horizontal bars scaled to `max` (default 100 for percentages), with an
 * optional reference line — the mobile analogue of the web subject-performance
 * bar chart.
 */
export function BarChart({
  data,
  max = 100,
  reference,
  unit = "%",
}: {
  data: BarDatum[];
  max?: number;
  reference?: number;
  unit?: string;
}) {
  const { colors, radius } = useTheme();

  return (
    <View style={styles.wrap}>
      {data.map((d) => {
        const pct = Math.max(0, Math.min(1, d.value / max));
        const passes = reference == null || d.value >= reference;
        return (
          <View key={d.label} style={styles.row}>
            <View style={styles.labelRow}>
              <Text variant="muted" numberOfLines={1} style={{ flex: 1 }}>
                {d.label}
              </Text>
              <Text weight="600">
                {d.value.toFixed(1)}
                {unit}
              </Text>
            </View>
            <View
              style={[styles.track, { backgroundColor: colors.muted }]}
            >
              <View
                style={{
                  width: `${pct * 100}%`,
                  height: "100%",
                  borderRadius: radius.sm,
                  backgroundColor: passes ? colors.primary : colors.destructive,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  row: {
    gap: 6,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  track: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
  },
});
