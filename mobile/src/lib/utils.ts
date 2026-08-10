import type { ViewStyle, TextStyle, ImageStyle } from "react-native";

type Style = ViewStyle | TextStyle | ImageStyle;

/**
 * Flatten a list of (possibly conditional) styles into an array RN accepts.
 * Mirrors the ergonomics of `cn()` on the web, for `style={cx(a, cond && b)}`.
 */
export function cx(
  ...styles: Array<Style | false | null | undefined>
): Style[] {
  return styles.filter(Boolean) as Style[];
}

export function getInitials(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const first = firstName?.[0] ?? "";
  const last = lastName?.[0] ?? "";
  const initials = `${first}${last}`.trim();
  return initials ? initials.toUpperCase() : "?";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
