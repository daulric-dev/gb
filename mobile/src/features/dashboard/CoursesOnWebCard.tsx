import { StyleSheet, View } from "react-native";
import { Monitor } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";

/** Course building, modules and the gradebook are web-only for now. */
export function CoursesOnWebCard() {
  const { colors } = useTheme();
  return (
    <Card>
      <CardContent style={styles.row}>
        <Monitor size={20} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="600">Courses are available on the web app</Text>
          <Text variant="muted" size="sm">
            Build modules, set work and mark in the gradebook from a browser.
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
});
