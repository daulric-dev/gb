import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

type Variant = "default" | "secondary" | "outline";

export function Badge({
  children,
  variant = "secondary",
}: {
  children: ReactNode;
  variant?: Variant;
}) {
  const { colors, radius } = useTheme();

  const bg = {
    default: colors.primary,
    secondary: colors.secondary,
    outline: "transparent",
  }[variant];

  const fg = {
    default: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
  }[variant];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          borderRadius: radius.full,
          borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
});
