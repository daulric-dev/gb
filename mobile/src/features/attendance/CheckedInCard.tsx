import { StyleSheet } from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/theme/ThemeProvider";
import { STATUS_LABEL, type AttendanceStatus } from "@/lib/attendance";

/** "You're checked in" confirmation shared by the code and QR check-in flows. */
export function CheckedInCard({
  status,
  onDone,
}: {
  status: AttendanceStatus;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <CardContent style={styles.center}>
        <CheckCircle2 color={colors.primary} size={96} strokeWidth={1.5} />
        <Text variant="title">You're checked in</Text>
        <Badge variant={status === "late" ? "outline" : "default"}>
          {STATUS_LABEL[status]}
        </Badge>
        <Button variant="outline" onPress={onDone} style={{ marginTop: 8 }}>
          Done
        </Button>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: 12, paddingVertical: 12 },
});
