import { useState } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/** Multiline text input, sharing the Input component's theming. */
export function TextArea({
  style,
  onFocus,
  onBlur,
  numberOfLines = 4,
  ...rest
}: TextInputProps) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      multiline
      numberOfLines={numberOfLines}
      textAlignVertical="top"
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        {
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: focused ? colors.ring : colors.input,
          borderRadius: radius.md,
          minHeight: 24 * numberOfLines,
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
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
