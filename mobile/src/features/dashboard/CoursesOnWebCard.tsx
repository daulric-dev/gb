import { StyleSheet, View } from "react-native";
import { Monitor } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";

/** Building course content is web-only; everything else is in the app. */
export function CoursesOnWebCard() {
  const { colors } = useTheme();
  return (
    <Card>
      <CardContent style={styles.row}>
        <Monitor size={20} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="600">Build courses on the web app</Text>
          <Text variant="muted" size="sm">
            Create modules, pages, quizzes and rubrics in a browser. Tap a course here to mark, post and moderate.
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
});
