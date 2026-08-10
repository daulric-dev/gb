import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "./Card";
import { Text } from "./Text";
import { Skeleton } from "./Skeleton";

export function StatCard({
  icon: Icon,
  value,
  label,
  loading,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.card}>
      <CardContent style={styles.content}>
        <View style={styles.row}>
          <Icon size={20} color={colors.primary} />
          <View style={styles.textCol}>
            {loading ? (
              <Skeleton style={{ height: 26, width: 60, marginBottom: 4 }} />
            ) : (
              <Text
                numberOfLines={1}
                style={{ fontSize: 22, fontWeight: "700" }}
              >
                {value}
              </Text>
            )}
            <Text variant="muted">{label}</Text>
          </View>
        </View>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
  },
  content: {
    padding: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textCol: {
    flex: 1,
  },
});
