import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from "react-native";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeProvider";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  /** Optional leading icon element. */
  icon?: ReactNode;
}

export function Button({
  variant = "default",
  size = "default",
  loading = false,
  disabled = false,
  children,
  icon,
  style,
  ...rest
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const isDisabled = disabled || loading;

  const bg = {
    default: colors.primary,
    secondary: colors.secondary,
    outline: "transparent",
    ghost: "transparent",
    destructive: colors.destructive,
  }[variant];

  const fg = {
    default: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
    ghost: colors.foreground,
    destructive: colors.destructiveForeground,
  }[variant];

  const height = { default: 40, sm: 34, lg: 46 }[size];
  const paddingHorizontal = { default: 16, sm: 12, lg: 20 }[size];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        {
          height,
          paddingHorizontal,
          backgroundColor: bg,
          borderRadius: radius.md,
          borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
          borderColor: colors.border,
          opacity: isDisabled ? 0.5 : state.pressed ? 0.85 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.content}>
          {icon}
          {typeof children === "string" ? (
            <Text
              style={[
                styles.label,
                { color: fg, fontSize: size === "sm" ? 13 : 14 },
              ]}
              numberOfLines={1}
            >
              {children}
            </Text>
          ) : (
            children
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontWeight: "600",
  },
});
