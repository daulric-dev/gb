import type { ComponentType, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { LucideProps } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "./Card";
import { Text } from "./Text";

/** Standard empty-state card: icon + title + optional description + action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <CardContent style={styles.wrap}>
        <Icon size={40} color={colors.mutedForeground} />
        <Text weight="600" style={{ marginTop: 12 }}>
          {title}
        </Text>
        {description ? (
          <Text variant="muted" style={styles.desc}>
            {description}
          </Text>
        ) : null}
        {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  desc: {
    textAlign: "center",
    marginTop: 4,
  },
});
