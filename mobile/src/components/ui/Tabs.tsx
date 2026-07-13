import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

/**
 * Underline tab bar for in-page section switching (e.g. Staff / Pending,
 * Academic Years / Terms). Horizontally scrollable when tabs overflow.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={[
              styles.tab,
              {
                borderBottomColor: active ? colors.foreground : "transparent",
              },
            ]}
          >
            <Text
              weight={active ? "600" : "500"}
              style={{
                color: active ? colors.foreground : colors.mutedForeground,
              }}
            >
              {tab.label}
            </Text>
            {tab.badge ? (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text
                  weight="600"
                  style={{ fontSize: 11, color: colors.primaryForeground }}
                >
                  {tab.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 4,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
