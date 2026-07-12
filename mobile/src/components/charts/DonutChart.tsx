import { StyleSheet, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";

export interface DonutSegment {
  key: string;
  name: string;
  value: number;
  color: string;
}

/**
 * SVG donut + legend, the mobile analogue of the web's recharts <PieChart>.
 */
export function DonutChart({
  data,
  size = 180,
  strokeWidth = 26,
}: {
  data: DonutSegment[];
  size?: number;
  strokeWidth?: number;
}) {
  const { colors } = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${center}, ${center}`}>
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={colors.muted}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {total > 0 &&
              data.map((segment) => {
                const fraction = segment.value / total;
                const dash = fraction * circumference;
                const circle = (
                  <Circle
                    key={segment.key}
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={segment.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                    fill="none"
                  />
                );
                offset += dash;
                return circle;
              })}
          </G>
        </Svg>
        <View style={styles.centerLabel} pointerEvents="none">
          <Text style={{ fontSize: 24, fontWeight: "700" }}>{total}</Text>
          <Text variant="muted" style={{ fontSize: 11 }}>
            total
          </Text>
        </View>
      </View>

      <View style={styles.legend}>
        {data.map((segment) => (
          <View key={segment.key} style={styles.legendRow}>
            <View
              style={[styles.dot, { backgroundColor: segment.color }]}
            />
            <Text variant="muted" style={{ flex: 1 }}>
              {segment.name}
            </Text>
            <Text weight="600">{segment.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: 16,
  },
  centerLabel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  legend: {
    alignSelf: "stretch",
    gap: 8,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
