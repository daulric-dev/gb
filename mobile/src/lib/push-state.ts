/**
 * This device's push registration, kept apart from push.ts so lib/api.ts can
 * clear it on a 401 without importing push.ts (which imports api.ts).
 *
 * In memory only: the API also drops a device's token when the session it
 * was registered under ends, so a token forgotten here (app restart, dead
 * session) is cleaned up server-side.
 */

/** The token this device registered, so logout can hand it back. */
let registeredToken: string | null = null;

/** The registration in flight, so logout can wait for it before unbinding. */
let pending: Promise<string | null> | null = null;

/**
 * Bumped whenever the registration is withdrawn (logout, push switched off,
 * session gone). A registration started before the bump must not POST.
 */
let generation = 0;

export const pushState = {
  get token() {
    return registeredToken;
  },
  set token(value: string | null) {
    registeredToken = value;
  },
  get pending() {
    return pending;
  },
  set pending(value: Promise<string | null> | null) {
    pending = value;
  },
  get generation() {
    return generation;
  },
  /** Withdraw: anything registering now stops before it binds the token. */
  bump() {
    generation += 1;
  },
};

/**
 * Forget the local registration without calling the API, for when the
 * session is already dead (a 401): the token can't be deleted as that user
 * any more, and the API unbinds it with the session.
 */
export function clearPushState(): void {
  generation += 1;
  registeredToken = null;
}
