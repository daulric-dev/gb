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
  const { colors, clay } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={{ flexGrow: 0 }}
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
                // Chips rather than an underlined rule: a hairline border is
                // the one thing clay surfaces never use.
                borderRadius: clay.radius.pill,
                backgroundColor: active ? colors.card : "transparent",
                boxShadow: active ? clay.raised : undefined,
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
    paddingHorizontal: 14,
    paddingVertical: 9,
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
