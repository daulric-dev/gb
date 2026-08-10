import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Dropdown select — the mobile analogue of the web app's shadcn `Select`.
 * A themed field that opens a modal option list.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
}: {
  value: T | "";
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: colors.input,
            backgroundColor: colors.background,
            borderRadius: radius.md,
            opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: selected ? colors.foreground : colors.mutedForeground,
          }}
        >
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.centerWrap} pointerEvents="box-none">
            <View
              style={[
                styles.menu,
                {
                  backgroundColor: colors.popover,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                  maxHeight: 400,
                  marginBottom: insets.bottom,
                },
              ]}
            >
              <ScrollView>
                {options.length === 0 ? (
                  <View style={styles.option}>
                    <Text variant="muted">No options</Text>
                  </View>
                ) : (
                  options.map((opt) => {
                    const active = opt.value === value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          onChange(opt.value);
                          setOpen(false);
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: pressed
                              ? colors.accent
                              : "transparent",
                          },
                        ]}
                      >
                        <Text style={{ flex: 1 }}>{opt.label}</Text>
                        {active ? (
                          <Check size={18} color={colors.foreground} />
                        ) : null}
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  menu: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
