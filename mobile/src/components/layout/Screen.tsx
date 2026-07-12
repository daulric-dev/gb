import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";

/** Page shell: safe-area aware, optional title/description header + scroll. */
export function Screen({
  children,
  title,
  description,
  action,
  scroll = true,
  refreshing,
  onRefresh,
  topInset = true,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  topInset?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const header = title ? (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text variant="heading" style={{ fontSize: 26 }}>
          {title}
        </Text>
        {description ? (
          <Text variant="muted" style={{ marginTop: 4 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  ) : null;

  const paddingTop = topInset ? insets.top + 8 : 8;

  if (!scroll) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop },
        ]}
      >
        {header}
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop, paddingBottom: insets.bottom + 32 },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
          />
        ) : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    gap: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
});
