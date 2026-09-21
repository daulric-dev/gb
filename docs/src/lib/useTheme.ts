import { useEffect, useState } from "react";

const THEME_KEY = "gb.docs.theme";

/**
 * Light or dark, remembered per reader.
 *
 * Starts from the stored choice, falling back to the operating system's. Every
 * storage access is guarded: a private window or blocked site data throws on
 * read, and a docs page should not fail to render over a colour preference.
 */
export function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored) return stored === "dark";
    } catch {
      /* fall through to the system setting */
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* not worth failing a render over */
    }
  }, [dark]);

  return [dark, setDark] as const;
}
