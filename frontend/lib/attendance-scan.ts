/**
 * Scan claims carry a QR check-in across sign-in. The public /scan page
 * stores one per session for this tab; the portal scan page spends it.
 * sessionStorage, not localStorage: a claim belongs to the tab that scanned.
 */
const key = (sessionId: string) => `attendance-claim:${sessionId}`;

export function storeScanClaim(sessionId: string, claim: string): void {
  try {
    sessionStorage.setItem(key(sessionId), claim);
  } catch {
    // Private mode or storage disabled: the student just scans again.
  }
}

export function readScanClaim(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(key(sessionId));
  } catch {
    return null;
  }
}

export function clearScanClaim(sessionId: string): void {
  try {
    sessionStorage.removeItem(key(sessionId));
  } catch {
    /* nothing stored */
  }
}
