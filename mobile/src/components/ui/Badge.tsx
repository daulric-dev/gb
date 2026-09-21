import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

type Variant = "default" | "secondary" | "outline";

export function Badge({
  children,
  variant = "secondary",
  color,
}: {
  children: ReactNode;
  variant?: Variant;
  /** Accent colour for text (and border, on the outline variant). */
  color?: string;
}) {
  const { colors, clay } = useTheme();

  const bg = {
    default: colors.primary,
    secondary: colors.secondary,
    outline: "transparent",
  }[variant];

  const fg =
    color ??
    {
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
          borderRadius: clay.radius.pill,
          borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
          // Too small to inflate; a soft lift is enough to keep it in family.
          boxShadow: variant === "outline" ? undefined : clay.raised,
          borderColor: color ?? colors.border,
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
