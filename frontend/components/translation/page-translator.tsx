"use client";

import { useEffect, useRef } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { PageTranslator as Engine } from "@/lib/page-translator";
import { DEFAULT_LANGUAGE, translationApi } from "@/lib/translation";
import {
  markTranslationUnavailable,
  translating,
  useCurrentLanguage,
  useStoredLanguage,
  useTranslationEnabled,
} from "./translation-state";

const UNAVAILABLE = "Translation isn't available right now";

async function translate(texts: string[], to: string): Promise<string[]> {
  const res = await translationApi.translate(texts, to);
  return res.translations;
}

/**
 * Translates the signed-in app in place while a language other than English
 * is chosen and the school has translation on (see lib/page-translator.ts).
 * Mounted once per app shell; unmounting restores the page. Renders nothing.
 */
export function PageTranslator() {
  useSignals();
  useStoredLanguage();
  const enabled = useTranslationEnabled();
  // The engine is a DOM controller, not React state: a ref, created on mount.
  const engine = useRef<Engine | null>(null);
  const warned = useRef(false);

  useEffect(() => {
    const notice = () => {
      if (warned.current) return;
      warned.current = true;
      toast(UNAVAILABLE, { id: "translation-unavailable" });
    };
    const e = new Engine({
      translate,
      onDisabled: () => {
        markTranslationUnavailable();
        notice();
      },
      onError: notice,
      onBusy: (busy) => (translating.value = busy),
    });
    engine.current = e;
    return () => {
      translating.value = false;
      e.destroy();
      engine.current = null;
    };
  }, []);

  // Effects run in order, so the engine above exists by now.
  const lang = useCurrentLanguage();
  useEffect(() => {
    engine.current?.setLanguage(enabled ? lang : DEFAULT_LANGUAGE);
  }, [enabled, lang]);

  return null;
}
