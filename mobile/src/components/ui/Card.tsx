import { View, StyleSheet, type ViewProps } from "react-native";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

/**
 * A clay surface: rounded, inflated, and floating above the background.
 *
 * No border - the inset highlight along the top edge and the shadow beneath
 * define the shape, and a hairline outline on top of that reads as a sticker
 * rather than a moulded object.
 */
export function Card({ style, children, ...rest }: ViewProps) {
  const { colors, clay } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderRadius: clay.radius.xl,
          boxShadow: clay.surface,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function CardHeader({ style, children, ...rest }: ViewProps) {
  return (
    <View style={[styles.header, style]} {...rest}>
      {children}
    </View>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <Text variant="subtitle">{children}</Text>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return (
    <Text variant="muted" style={{ marginTop: 2 }}>
      {children}
    </Text>
  );
}

export function CardContent({ style, children, ...rest }: ViewProps) {
  return (
    <View style={[styles.content, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Not clipped: an inset shadow is painted inside the view, but clipping
    // children to the radius would also crop the soft edge it depends on.
    overflow: "visible",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  content: {
    padding: 20,
  },
});
