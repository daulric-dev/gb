import React, { createContext, useContext, useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "system",
  isDark: false,
  setMode: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem("gb_manager_theme") as ThemeMode) || "system";
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function update() {
      const dark = mode === "dark" || (mode === "system" && media.matches);
      setIsDark(dark);
      if (dark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem("gb_manager_theme", newMode);
  };

  const toggleTheme = () => {
    setMode(isDark ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
