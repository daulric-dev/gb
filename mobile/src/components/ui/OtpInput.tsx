import { useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

/**
 * 8-digit one-time-code input, mirroring the web app's grouped 4-4 layout.
 * A single hidden TextInput captures keystrokes; the boxes are display-only.
 */
export function OtpInput({
  value,
  onChange,
  length = 8,
  autoFocus,
  error = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  /** Paints every box red. The boxes are the cue people actually read. */
  error?: boolean;
  disabled?: boolean;
}) {
  const { colors, clay } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Eight boxes plus their gaps are wider than a phone's card, so they are
  // sized to whatever room the row actually gets rather than a fixed width.
  const [available, setAvailable] = useState(0);

  const digits = value.split("");
  const groupSize = Math.ceil(length / 2);

  const GAP = 6;
  const SEPARATOR = 16;
  const slotWidth = available
    ? Math.max(
        26,
        Math.min(
          44,
          Math.floor(
            (available - GAP * (length - 2) - SEPARATOR) / length,
          ),
        ),
      )
    : 34;

  function focus() {
    if (!disabled) inputRef.current?.focus();
  }

  function renderSlot(index: number) {
    const char = digits[index] ?? "";
    const isActive = focused && index === Math.min(value.length, length - 1);
    return (
      <View
        key={index}
        style={[
          styles.slot,
          {
            width: slotWidth,
            height: Math.round(slotWidth * 1.2),
            borderColor: error
              ? colors.destructive
              : isActive
                ? colors.ring
                : "transparent",
            backgroundColor: colors.background,
            // The smallest step: on a box this size the larger radii
            // round it into a pill.
            borderRadius: clay.radius.sm,
            boxShadow: clay.inset,
          },
        ]}
      >
        <Text style={{ fontSize: 20, fontWeight: "600" }}>{char}</Text>
      </View>
    );
  }

  const first = Array.from({ length: groupSize }, (_, i) => i);
  const second = Array.from(
    { length: length - groupSize },
    (_, i) => i + groupSize,
  );

  return (
    <Pressable
      onPress={focus}
      style={[styles.row, disabled && { opacity: 0.6 }]}
      onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
    >
      <View style={[styles.group, { gap: GAP }]}>{first.map(renderSlot)}</View>
      <View style={styles.separator}>
        <Text tone="muted" style={{ fontSize: 20 }}>
          –
        </Text>
      </View>
      <View style={[styles.group, { gap: GAP }]}>{second.map(renderSlot)}</View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) =>
          onChange(text.replace(/\D/g, "").slice(0, length))
        }
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  group: {
    flexDirection: "row",
  },
  slot: {
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  separator: {
    paddingHorizontal: 2,
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
