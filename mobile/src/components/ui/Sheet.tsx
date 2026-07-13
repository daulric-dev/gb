import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "./Text";

/**
 * Bottom-sheet modal — the mobile analogue of the web app's shadcn `Dialog`.
 * Slides up from the bottom, dims the backdrop, and dismisses on backdrop tap.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.grabber}>
            <View
              style={[styles.grabberBar, { backgroundColor: colors.border }]}
            />
          </View>
          {(title || description) && (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title ? <Text variant="subtitle">{title}</Text> : null}
                {description ? (
                  <Text variant="muted" style={{ marginTop: 2 }}>
                    {description}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 560 }}
            contentContainerStyle={styles.content}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  avoider: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabberBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  close: {
    padding: 4,
  },
  content: {
    padding: 20,
    gap: 16,
  },
});
