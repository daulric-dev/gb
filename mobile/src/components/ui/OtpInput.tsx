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
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
}) {
  const { colors, radius } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = value.split("");
  const groupSize = Math.ceil(length / 2);

  function focus() {
    inputRef.current?.focus();
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
            borderColor: isActive ? colors.ring : colors.input,
            backgroundColor: colors.background,
            borderRadius: radius.md,
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
    <Pressable onPress={focus} style={styles.row}>
      <View style={styles.group}>{first.map(renderSlot)}</View>
      <View style={styles.separator}>
        <Text tone="muted" style={{ fontSize: 20 }}>
          –
        </Text>
      </View>
      <View style={styles.group}>{second.map(renderSlot)}</View>

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
    gap: 8,
  },
  group: {
    flexDirection: "row",
    gap: 8,
  },
  slot: {
    width: 40,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
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
