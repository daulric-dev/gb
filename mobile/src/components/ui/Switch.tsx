import { Switch as RNSwitch, type SwitchProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/** Themed wrapper around React Native's Switch. */
export function Switch({ value, onValueChange, ...rest }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: colors.muted, true: colors.primary }}
      thumbColor={colors.background}
      ios_backgroundColor={colors.muted}
      {...rest}
    />
  );
}
