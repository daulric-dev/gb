import { StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/** A small status dot; green when online, muted otherwise. */
export function PresenceDot({
  online,
  size = 10,
  style,
}: {
  online: boolean;
  size?: number;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={online ? "Online" : "Offline"}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: online ? "#22c55e" : colors.mutedForeground,
          opacity: online ? 1 : 0.4,
        },
        style,
      ]}
    />
  );
}

/** Avatar-corner presence dot: absolutely positioned with a ring for contrast. */
export function AvatarPresenceDot({ online }: { online: boolean }) {
  const { colors } = useTheme();
  return (
    <PresenceDot
      online={online}
      size={12}
      style={{
        ...styles.corner,
        borderWidth: 2,
        borderColor: colors.background,
      }}
    />
  );
}

const styles = StyleSheet.create({
  corner: {
    position: "absolute",
    bottom: -1,
    right: -1,
  },
});
