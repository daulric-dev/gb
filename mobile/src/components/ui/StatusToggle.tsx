import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export type AttendanceStatus = "present" | "absent" | "late";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late"];

/** Colours mirror the web app's attendance toggle (emerald / amber / rose). */
const ACTIVE_BG: Record<AttendanceStatus, string> = {
  present: "#059669",
  late: "#f59e0b",
  absent: "#e11d48",
};

/** Segmented present/absent/late toggle used on the attendance roster. */
export function StatusToggle({
  value,
  onChange,
  disabled = false,
}: {
  value?: AttendanceStatus;
  onChange: (status: AttendanceStatus) => void;
  disabled?: boolean;
}) {
  const { colors, radius } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        { borderColor: colors.border, borderRadius: radius.md },
      ]}
    >
      {STATUSES.map((s, i) => {
        const active = value === s;
        return (
          <Pressable
            key={s}
            disabled={disabled}
            onPress={() => onChange(s)}
            style={[
              styles.segment,
              i > 0 && {
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderLeftColor: colors.border,
              },
              active && { backgroundColor: ACTIVE_BG[s] },
              disabled && !active && { opacity: 0.5 },
            ]}
          >
            <Text
              weight="600"
              style={{
                fontSize: 12,
                textTransform: "capitalize",
                color: active ? "#ffffff" : colors.mutedForeground,
              }}
            >
              {s}
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
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
});
