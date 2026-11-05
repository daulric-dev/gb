import { Modal, StyleSheet, View } from "react-native";
import { ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, CardContent } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";

/** The rules a lockdown quiz shows before an attempt starts. */
export function LockdownStartCard({
  details,
  startLabel,
  busy,
  onStart,
}: {
  details: string;
  startLabel: string;
  busy: boolean;
  onStart: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <CardContent style={{ gap: 8 }}>
        <View style={styles.row}>
          <ShieldCheck color={colors.primary} size={20} />
          <Text weight="500" style={{ flex: 1 }}>
            This quiz is monitored
          </Text>
        </View>
        <Text variant="muted" size="sm">
          Stay in the app until you submit. Your teacher sees when you leave
          the quiz and how many times.
        </Text>
        <Text variant="muted" size="sm">
          {"•"} Switching to another app or going to the home screen is
          reported to your teacher.{"\n"}
          {"•"} Your phone cannot be fully locked; this only notifies your
          teacher.
        </Text>
        <Text variant="muted" size="sm">
          {details}
        </Text>
        <Button onPress={onStart} loading={busy}>
          {startLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Covers the quiz after the student left the app, until they tap back in. */
export function LockdownOverlay({
  visible,
  timeLeft,
  onReturn,
}: {
  visible: boolean;
  timeLeft?: string | null;
  onReturn: () => void;
}) {
  const { colors, clay } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onReturn}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: clay.radius.xl,
            },
          ]}
          accessibilityRole="alert"
        >
          <ShieldAlert color={colors.destructive} size={36} />
          <Text variant="subtitle" style={{ textAlign: "center" }}>
            Return to your quiz
          </Text>
          <Text variant="muted" style={{ textAlign: "center" }}>
            You left the app. Your teacher has been notified. Your answers are
            saved{timeLeft ? " and the timer is still running" : ""}.
          </Text>
          {timeLeft ? (
            <Text weight="600" style={styles.timer}>
              {timeLeft}
            </Text>
          ) : null}
          <Button onPress={onReturn}>Return to quiz</Button>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
  },
  timer: {
    fontFamily: "monospace",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
  },
});
