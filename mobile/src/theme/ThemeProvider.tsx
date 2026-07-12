import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  darkColors,
  lightColors,
  radius,
  spacing,
  fontSize,
  type ThemeColors,
} from "./colors";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  colors: ThemeColors;
  scheme: "light" | "dark";
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  radius: typeof radius;
  spacing: typeof spacing;
  fontSize: typeof fontSize;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MODE_KEY = "gb.theme.mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setModeState(stored);
        }
      })
      .catch(() => {
        /* first run / unavailable — keep default */
      });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(MODE_KEY, next).catch(() => {});
  }, []);

  const scheme: "light" | "dark" =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: scheme === "dark" ? darkColors : lightColors,
      scheme,
      mode,
      setMode,
      radius,
      spacing,
      fontSize,
    }),
    [scheme, mode, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
