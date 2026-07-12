import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { fontSize } from "@/theme/colors";

type Variant =
  | "default"
  | "muted"
  | "heading"
  | "title"
  | "subtitle"
  | "label";

export interface TextProps extends RNTextProps {
  variant?: Variant;
  /** Use a token colour by key, e.g. "primary", "destructive". */
  tone?:
    | "foreground"
    | "muted"
    | "primary"
    | "destructive"
    | "cardForeground";
  size?: keyof typeof fontSize;
  weight?: "400" | "500" | "600" | "700";
}

export function Text({
  variant = "default",
  tone,
  size,
  weight,
  style,
  ...rest
}: TextProps) {
  const { colors } = useTheme();

  const variantStyle = (() => {
    switch (variant) {
      case "heading":
        return { fontSize: fontSize["3xl"], fontWeight: "700" as const };
      case "title":
        return { fontSize: fontSize.xl, fontWeight: "600" as const };
      case "subtitle":
        return { fontSize: fontSize.lg, fontWeight: "600" as const };
      case "label":
        return { fontSize: fontSize.sm, fontWeight: "500" as const };
      case "muted":
        return { fontSize: fontSize.sm, fontWeight: "400" as const };
      default:
        return { fontSize: fontSize.base, fontWeight: "400" as const };
    }
  })();

  const color = (() => {
    if (tone) {
      const map = {
        foreground: colors.foreground,
        muted: colors.mutedForeground,
        primary: colors.primary,
        destructive: colors.destructive,
        cardForeground: colors.cardForeground,
      };
      return map[tone];
    }
    return variant === "muted"
      ? colors.mutedForeground
      : colors.foreground;
  })();

  return (
    <RNText
      style={[
        variantStyle,
        { color },
        size ? { fontSize: fontSize[size] } : null,
        weight ? { fontWeight: weight } : null,
        style,
      ]}
      {...rest}
    />
  );
}
