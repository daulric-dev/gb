"use client";

import { useEffect, useSyncExternalStore } from "react";
import { signal, type ReadonlySignal } from "@preact/signals-react";
import { useProfile } from "@/providers/AuthProvider";
import {
  DEFAULT_LANGUAGE,
  readStoredLanguage,
  storeLanguage,
  translationApi,
  type LanguageCode,
} from "@/lib/translation";

/**
 * Shared translation state: the language chosen in this browser and whether
 * translation is available for the signed-in user's school. The picker, the
 * page translator and the teacher's "Translate into…" read the same signals,
 * so the status is asked for once per user and school.
 */

/**
 * A module-level signal's value as a hook. The React Compiler treats a
 * global's `.value` read in render as a constant and caches it (and effect
 * dependencies built from it) forever; a hook result is tracked as changing.
 */
export function useGlobalSignal<T>(s: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (onChange) => s.subscribe(() => onChange()),
    () => s.peek(),
    () => s.peek(),
  );
}

/** The chosen language; English until the stored choice is read after mount. */
export const currentLanguage = signal<LanguageCode>(DEFAULT_LANGUAGE);
let languageLoaded = false;

/** True while translation requests are in flight (the picker shows a spinner). */
export const translating = signal(false);

/** The chosen language (tracked by the React Compiler). */
export function useCurrentLanguage(): LanguageCode {
  return useGlobalSignal(currentLanguage);
}

export function chooseLanguage(code: LanguageCode): void {
  currentLanguage.value = code;
  storeLanguage(code);
}

/** Reads the stored choice once (after hydration, so the server render stays English). */
export function useStoredLanguage(): void {
  useEffect(() => {
    if (languageLoaded) return;
    languageLoaded = true;
    currentLanguage.value = readStoredLanguage();
  }, []);
}

const status = signal<{ key: string; enabled: boolean } | null>(null);
let pendingKey: string | null = null;

/** Turn translation off for this session (the API said the feature is off). */
export function markTranslationUnavailable(): void {
  if (status.value) status.value = { ...status.value, enabled: false };
}

/**
 * Whether translation is on for the signed-in user's active school
 * (`GET /translation/status`). False while unknown, for signed-out users,
 * when the profile already says the `translation` feature is off, and when
 * the server has no translation at all.
 */
export function useTranslationEnabled(): boolean {
  const { profile } = useProfile();
  const p = profile.value;
  const key = p ? `${p.id}:${p.school?.id ?? ""}` : null;
  // An explicit "off" in the profile saves the request. A missing key (a
  // parent account, an older server) still asks: the status is the authority.
  const featureOff = p?.features?.translation === false;

  useEffect(() => {
    if (!key || featureOff) return;
    if (status.value?.key === key || pendingKey === key) return;
    pendingKey = key;
    translationApi
      .status()
      .then((s) => {
        status.value = { key, enabled: !!s?.enabled };
      })
      .catch(() => {
        status.value = { key, enabled: false };
      })
      .finally(() => {
        if (pendingKey === key) pendingKey = null;
      });
  }, [key, featureOff]);

  const s = useGlobalSignal(status);
  return !!key && !featureOff && s?.key === key && s.enabled;
}
