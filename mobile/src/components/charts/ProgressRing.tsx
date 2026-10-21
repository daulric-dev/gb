import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * A single-value ring: a muted track with an arc filled to `percent` (0-100).
 * Whatever is passed as children sits centred inside the ring.
 */
export function ProgressRing({
  percent,
  color,
  size = 160,
  strokeWidth = 16,
  children,
}: {
  percent: number | null;
  color: string;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const fraction = Math.max(0, Math.min(100, percent ?? 0)) / 100;
  const dash = fraction * circumference;

  return (
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
          {dash > 0 && (
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="round"
              fill="none"
            />
          )}
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
