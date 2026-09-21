import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors, clay } = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.muted,
          borderRadius: clay.radius.pill,
          // The track is a groove, the selected segment the thing sitting in it.
          boxShadow: clay.inset,
        },
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segment,
              {
                borderRadius: clay.radius.pill,
                backgroundColor: active ? colors.card : "transparent",
                boxShadow: active ? clay.raised : undefined,
              },
            ]}
          >
            <Text
              weight={active ? "600" : "500"}
              style={{
                fontSize: 13,
                color: active ? colors.foreground : colors.mutedForeground,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
});
