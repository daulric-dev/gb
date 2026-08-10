import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleCheck, CircleX } from "lucide-react-native";
import { useTheme } from "@/theme/ThemeProvider";

type ToastKind = "success" | "error";

interface ToastState {
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Lightweight stand-in for the web app's `sonner` toasts. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colors, radius } = useTheme();
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (message: string, kind: ToastKind) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, kind });
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 3000);
    },
    [opacity],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const value: ToastContextValue = {
    success: (m) => show(m, "success"),
    error: (m) => show(m, "error"),
  };

  const Icon = toast?.kind === "error" ? CircleX : CircleCheck;
  const iconColor = toast?.kind === "error" ? colors.destructive : colors.chart2;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { bottom: insets.bottom + 24, opacity },
          ]}
        >
          <View
            style={[
              styles.toast,
              {
                backgroundColor: colors.popover,
                borderColor: colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            <Icon size={18} color={iconColor} />
            <Text
              style={[styles.text, { color: colors.popoverForeground }]}
              numberOfLines={3}
            >
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 440,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
});
