/** A signed-in device, as GET /auth/sessions returns it. */
export interface SignedInSession {
  id: string;
  current: boolean;
  method: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** The anchor the "New sign-in" email links to. */
export const DEVICES_ANCHOR = "devices";

/** Phones and tablets (and the app) get a phone icon; everything else a computer. */
export function isMobileDevice(device: string): boolean {
  return /GradeBook app|iPhone|iPad|Android|\biOS\b/i.test(device);
}

/** How someone signed in, for the device list. */
export function methodLabel(method: string): string {
  if (method === "email-code") return "Email code";
  if (!method) return "";
  return `${method.charAt(0).toUpperCase()}${method.slice(1)} sign-in`;
}

/** "Active now", "Last active 5 min ago", "... 3 h ago", "... 2 days ago", then a date. */
export function lastActiveLabel(
  session: Pick<SignedInSession, "current" | "lastSeenAt">,
  now = Date.now(),
): string {
  if (session.current) return "Active now";
  const t = new Date(session.lastSeenAt).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Last active just now";
  if (s < 3600) return `Last active ${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `Last active ${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  if (days < 7) return `Last active ${days} day${days === 1 ? "" : "s"} ago`;
  return `Last active ${new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}
