/**
 * Design tokens ported from the web frontend's `globals.css`.
 *
 * The web app defines its palette in oklch on the shadcn "neutral" base.
 * React Native has no oklch support, so these are the sRGB-hex equivalents of
 * that same neutral scale (light + dark), keeping the two apps visually aligned.
 */

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export const lightColors: ThemeColors = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  popover: "#ffffff",
  popoverForeground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f5f5f5",
  secondaryForeground: "#171717",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  accent: "#f5f5f5",
  accentForeground: "#171717",
  destructive: "#dc2626",
  destructiveForeground: "#fafafa",
  border: "#e5e5e5",
  input: "#e5e5e5",
  ring: "#a3a3a3",
  chart1: "#e8703a",
  chart2: "#2eb88a",
  chart3: "#2f5f8f",
  chart4: "#efc453",
  chart5: "#f0a63a",
};

export const darkColors: ThemeColors = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  cardForeground: "#fafafa",
  popover: "#171717",
  popoverForeground: "#fafafa",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  secondary: "#262626",
  secondaryForeground: "#fafafa",
  muted: "#262626",
  mutedForeground: "#a3a3a3",
  accent: "#262626",
  accentForeground: "#fafafa",
  destructive: "#ef4444",
  destructiveForeground: "#fafafa",
  border: "rgba(255,255,255,0.1)",
  input: "rgba(255,255,255,0.15)",
  ring: "#737373",
  chart1: "#6366f1",
  chart2: "#34d399",
  chart3: "#f0a63a",
  chart4: "#a855f7",
  chart5: "#ec4899",
};

/** --radius: 0.625rem (10px) on web, with the derived scale. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  "2xl": 18,
  full: 9999,
};

/** 4px spacing scale, matching Tailwind's default rhythm. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
};

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
};
