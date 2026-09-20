import { useState } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export function Input({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const { colors, clay } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        // Web only: React Native Web paints a browser focus ring on top of the
        // hollow, which reads as a hard outline against everything else here.
        // Native has no such outline, and the prop is ignored there.
        { outlineStyle: "none" } as object,
        {
          color: colors.foreground,
          // Carved into the surface rather than sitting on it: the inset
          // shadow does the work, and focus lights the rim instead of
          // thickening a border.
          backgroundColor: colors.background,
          borderColor: focused ? colors.ring : "transparent",
          borderRadius: clay.radius.md,
          boxShadow: clay.inset,
        },
        style,
      ]}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    height: 48,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
