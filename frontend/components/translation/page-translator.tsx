"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { PageTranslator as Engine } from "@/lib/page-translator";
import { DEFAULT_LANGUAGE, sharedTranslationCache, translationApi } from "@/lib/translation";
import {
  clearTranslationSession,
  markTranslationUnavailable,
  translating,
  useCurrentLanguage,
  useStoredLanguage,
  useTranslationEnabled,
} from "./translation-state";
import { TranslationOffer } from "./translation-offer";

const UNAVAILABLE = "Translation isn't available right now";

async function translate(texts: string[], to: string): Promise<string[]> {
  const res = await translationApi.translate(texts, to);
  return res.translations;
}

/**
 * Translates the signed-in app in place while a language other than English
 * is chosen and the school has translation on (see lib/page-translator.ts,
 * which also decides what is never sent). Mounted once per app shell;
 * unmounting restores the page. Renders only the one-time language question.
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
      // One cache per tab, emptied on sign-out (AuthProvider).
      cache: sharedTranslationCache(),
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
      // Leaving the app shell is how every sign-out button goes to /login:
      // forget this tab's cached translations (memory and sessionStorage).
      clearTranslationSession();
    };
  }, []);

  // Effects run in order, so the engine above exists by now.
  const lang = useCurrentLanguage();
  useEffect(() => {
    engine.current?.setLanguage(enabled ? lang : DEFAULT_LANGUAGE);
  }, [enabled, lang]);

  // Client navigation: blocked pages (messages, pastoral, student records…)
  // are restored and nothing on them is sent; others are translated again.
  // The engine also checks the path before every pass and request.
  const pathname = usePathname();
  useEffect(() => {
    engine.current?.routeChanged();
  }, [pathname]);

  return <TranslationOffer />;
}
