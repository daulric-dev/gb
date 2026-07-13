import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Calendar, X } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";
import { Button } from "./Button";

/** yyyy-mm-dd (local) from a Date. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a yyyy-mm-dd string into a local Date (noon avoids TZ edge cases). */
function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12);
}

function formatDisplay(iso: string): string {
  const d = fromIsoDate(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Native date picker field — wraps @react-native-community/datetimepicker.
 * `value`/`onChange` use yyyy-mm-dd strings to match the web app's date inputs.
 */
export function DateField({
  value,
  onChange,
  maximumDate,
  minimumDate,
  placeholder = "Select date",
  clearable = false,
}: {
  value: string;
  onChange: (iso: string) => void;
  maximumDate?: Date;
  minimumDate?: Date;
  placeholder?: string;
  clearable?: boolean;
}) {
  const { colors, radius, scheme } = useTheme();
  const [show, setShow] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    // On Android the picker is a one-shot dialog; close it on any result.
    if (Platform.OS !== "ios") setShow(false);
    if (event.type === "set" && date) onChange(toIsoDate(date));
  };

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setShow((s) => !s)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: colors.input,
            backgroundColor: colors.background,
            borderRadius: radius.md,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Calendar size={18} color={colors.mutedForeground} />
        <Text style={{ flex: 1, color: value ? colors.foreground : colors.mutedForeground }}>
          {value ? formatDisplay(value) : placeholder}
        </Text>
        {clearable && value ? (
          <Pressable hitSlop={8} onPress={() => onChange("")}>
            <X size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </Pressable>

      {show && (
        <View style={Platform.OS === "ios" ? styles.iosWrap : undefined}>
          <DateTimePicker
            value={value ? fromIsoDate(value) : new Date()}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onChange={handleChange}
            themeVariant={scheme}
          />
          {Platform.OS === "ios" && (
            <Button size="sm" onPress={() => setShow(false)}>
              Done
            </Button>
          )}
        </View>
      )}
    </View>
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
  iosWrap: {
    gap: 8,
    alignItems: "center",
  },
});
