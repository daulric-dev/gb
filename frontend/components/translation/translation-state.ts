"use client";

import { useEffect, useSyncExternalStore } from "react";
import { signal, type ReadonlySignal } from "@preact/signals-react";
import { useProfile } from "@/providers/AuthProvider";
import {
  clearTranslationCache,
  DEFAULT_LANGUAGE,
  languageToOffer,
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
  // A choice from the menu answers the one-time question too.
  offeredLanguage.value = null;
  currentLanguage.value = code;
  storeLanguage(code);
}

/**
 * The device language to offer once ("Translate GradeBook into …?"), or
 * null: set after hydration only when nothing is stored in this browser.
 */
export const offeredLanguage = signal<LanguageCode | null>(null);

/** Reads the stored choice once (after hydration, so the server render stays English). */
export function useStoredLanguage(): void {
  useEffect(() => {
    if (languageLoaded) return;
    languageLoaded = true;
    // English unless a choice was stored: the device language is only offered.
    currentLanguage.value = readStoredLanguage();
    offeredLanguage.value = languageToOffer();
  }, []);
}

/** The answer to the one-time prompt: the language, or "en" for "No thanks". Stored either way. */
export function answerLanguageOffer(code: LanguageCode): void {
  chooseLanguage(code);
}

/**
 * Sign-out: forget cached translations (memory and sessionStorage) and the
 * translation status. The language choice stays (a browser preference).
 */
export function clearTranslationSession(): void {
  clearTranslationCache();
  status.value = null;
  pendingKey = null;
}

const status = signal<{ key: string; enabled: boolean; engine: string | null } | null>(null);
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
        status.value = {
          key,
          enabled: !!s?.enabled,
          engine: typeof s?.engine === "string" && s.engine ? s.engine : null,
        };
      })
      .catch(() => {
        status.value = { key, enabled: false, engine: null };
      })
      .finally(() => {
        if (pendingKey === key) pendingKey = null;
      });
  }, [key, featureOff]);

  const s = useGlobalSignal(status);
  return !!key && !featureOff && s?.key === key && s.enabled;
}

/**
 * The translation service's display name for the consent prompt ("DeepL",
 * "LibreTranslate (your school's server)"); null while unknown. Call after
 * `useTranslationEnabled` (which fetches the status).
 */
export function useTranslationEngineName(): string | null {
  return useGlobalSignal(status)?.engine ?? null;
}
