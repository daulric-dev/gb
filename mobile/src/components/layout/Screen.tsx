import type { ReactNode } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/components/ui/Text";

/**
 * Page shell: safe-area aware, optional title/description header, and pull to
 * refresh wherever a screen can reload itself.
 *
 * Insets are applied on all four edges, not just the top. The status bar and
 * notch are the obvious ones, but a phone held sideways puts the notch on a
 * side, and the home indicator sits over the bottom of any screen that is not
 * inside the tab bar. `useSafeAreaInsets` reports all of them, so all of them
 * are honoured here rather than in every screen.
 */
export function Screen({
  children,
  title,
  description,
  action,
  onBack,
  scroll = true,
  refreshing,
  onRefresh,
  topInset = true,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  onBack?: () => void;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  topInset?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const header = title ? (
    <View style={{ gap: 8 }}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ArrowLeft size={20} color={colors.mutedForeground} />
          <Text variant="muted">Back</Text>
        </Pressable>
      ) : null}
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
    </View>
  ) : null;

  const paddingTop = topInset ? insets.top + 8 : 8;
  // Landscape on a notched phone puts the cutout on a side, so the horizontal
  // gutter grows by whatever the system reports rather than being a constant.
  const paddingLeft = insets.left + GUTTER;
  const paddingRight = insets.right + GUTTER;

  if (!scroll) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            flex: 1,
            paddingTop,
            paddingLeft,
            paddingRight,
            // A non-scrolling screen has no content inset to fall back on, so
            // the home indicator would otherwise sit on top of its last row.
            paddingBottom: insets.bottom,
          },
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
        {
          paddingTop,
          paddingLeft,
          paddingRight,
          paddingBottom: insets.bottom + 32,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      // Content can be shorter than the screen and still need reloading, so
      // the bounce is always on where a refresh handler exists.
      alwaysBounceVertical={!!onRefresh}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.mutedForeground}
            colors={[colors.foreground]}
            progressBackgroundColor={colors.card}
            // Otherwise the spinner is hidden behind the notch.
            progressViewOffset={topInset ? insets.top : 0}
          />
        ) : undefined
      }
    >
      {header}
      {children}
    </ScrollView>
  );
}

const GUTTER = 16;

const styles = StyleSheet.create({
  container: {
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
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: -4,
  },
});
