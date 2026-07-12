import { useState } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export function Input({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        {
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: focused ? colors.ring : colors.input,
          borderRadius: radius.md,
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
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
