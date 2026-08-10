import { View, StyleSheet, type ViewProps } from "react-native";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

export function Card({ style, children, ...rest }: ViewProps) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.xl,
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
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
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
