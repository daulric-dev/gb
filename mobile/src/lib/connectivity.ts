/**
 * Whether the school server can be reached, judged from real requests.
 *
 * There is no network-state package in the app, and "the phone has Wi-Fi" is
 * not the question anyway (captive portals, a server that is down, a VPN): a
 * request that never got an answer (`fetch` rejected) marks the app offline,
 * any answer at all marks it online. While offline, `OfflineProvider` probes
 * the server with a backoff and on returning to the foreground.
 *
 * No React Native imports, so the API client and tests can use it.
 */

export type Connectivity = "online" | "offline";

let status: Connectivity = "online";
let since: number | null = null;
const listeners = new Set<(status: Connectivity) => void>();

export function connectivity(): Connectivity {
  return status;
}

export function isOffline(): boolean {
  return status === "offline";
}

/** When the app last went offline, or null while online. */
export function offlineSince(): number | null {
  return since;
}

function set(next: Connectivity) {
  if (status === next) return;
  status = next;
  since = next === "offline" ? Date.now() : null;
  for (const listener of [...listeners]) listener(next);
}

/** A request got no answer at all. */
export function reportNetworkFailure(): void {
  set("offline");
}

/** A request got an answer (any status). */
export function reportNetworkSuccess(): void {
  set("online");
}

export function subscribeConnectivity(
  listener: (status: Connectivity) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How long to wait before the next probe while offline: 5s doubling to 60s. */
export function probeDelayMs(failedProbes: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, failedProbes), 60_000);
}
