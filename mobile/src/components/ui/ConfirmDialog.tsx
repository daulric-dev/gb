import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";
import { Button } from "./Button";

/**
 * Centered confirmation dialog — the mobile analogue of the web's AlertDialog.
 * Controlled: render with `open` and handle `onConfirm` / `onCancel`.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors, radius } = useTheme();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <View style={styles.centerWrap} pointerEvents="box-none">
          <Pressable
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: radius.xl,
              },
            ]}
          >
            <Text variant="subtitle">{title}</Text>
            {message ? (
              <Text variant="muted" style={{ marginTop: 8 }}>
                {message}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button variant="outline" onPress={onCancel} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                variant={destructive ? "destructive" : "default"}
                onPress={onConfirm}
                loading={loading}
              >
                {confirmLabel}
              </Button>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 20,
  },
});
