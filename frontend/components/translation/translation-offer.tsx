"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { Languages } from "lucide-react";
import { DEFAULT_LANGUAGE, LANGUAGES } from "@/lib/translation";
import { Button } from "@/components/ui/button";
import {
  answerLanguageOffer,
  offeredLanguage,
  useGlobalSignal,
  useStoredLanguage,
  useTranslationEnabled,
  useTranslationEngineName,
} from "./translation-state";

/**
 * The one-time, non-blocking question shown when this browser has no
 * language choice yet, the device prefers a language GradeBook offers and
 * the school has translation on. Nothing is sent before an answer: the page
 * stays in English. Either answer is stored (`gb_language`), so it is not
 * asked again in this browser; closing the page without answering asks
 * again next time. Never translated itself (`translate="no"`).
 */
export function TranslationOffer() {
  useSignals();
  useStoredLanguage();
  const enabled = useTranslationEnabled();
  const engine = useTranslationEngineName();
  const offered = useGlobalSignal(offeredLanguage);
  // Wait for the engine's name: the question must say where the text goes.
  if (!enabled || !offered || !engine) return null;
  const language = LANGUAGES.find((l) => l.code === offered);
  if (!language) return null;

  return (
    <div
      role="region"
      aria-label="Translation"
      translate="no"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg border bg-background p-4 text-sm shadow-lg sm:left-auto sm:right-4 sm:mx-0"
    >
      <div className="flex items-start gap-3">
        <Languages className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-3">
          <p>
            <span className="font-medium">
              Translate GradeBook into <span lang={language.code}>{language.label}</span>
              {language.label !== language.english && ` (${language.english})`}?
            </span>{" "}
            <span className="text-muted-foreground">
              Page text is sent to {engine} (machine translation). You can change this at any time
              in the language menu.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => answerLanguageOffer(language.code)}>
              Translate
            </Button>
            <Button size="sm" variant="outline" onClick={() => answerLanguageOffer(DEFAULT_LANGUAGE)}>
              No thanks
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
