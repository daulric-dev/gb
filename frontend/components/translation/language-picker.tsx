"use client";

import { useSignals } from "@preact/signals-react/runtime";
import { Languages, Loader2 } from "lucide-react";
import { isLanguageCode, LANGUAGES } from "@/lib/translation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  chooseLanguage,
  translating,
  useCurrentLanguage,
  useGlobalSignal,
  useStoredLanguage,
  useTranslationEnabled,
} from "./translation-state";

/**
 * The header's language menu. Shown only while the school has translation
 * on. English is the default and sends nothing; the choice is kept in this
 * browser. Language names are never translated (`translate="no"`).
 */
export function LanguagePicker() {
  useSignals();
  useStoredLanguage();
  const enabled = useTranslationEnabled();
  const lang = useCurrentLanguage();
  const busy = useGlobalSignal(translating);
  if (!enabled) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2"
            aria-label="Language"
            title="Language (machine translated)"
            translate="no"
            aria-busy={busy}
          />
        }
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Languages className="size-4" aria-hidden />
        )}
        <span className="text-xs font-medium uppercase">{lang}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Language</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={lang}
            onValueChange={(v) => {
              if (isLanguageCode(v)) chooseLanguage(v);
            }}
            translate="no"
          >
            {LANGUAGES.map((l) => (
              <DropdownMenuRadioItem key={l.code} value={l.code} closeOnClick>
                <span lang={l.code}>{l.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Machine translated, so it may contain mistakes. The text on each page you view is sent to
          your school&rsquo;s translation service. Messages and pastoral notes are never sent;
          names, marks and feedback are left out where GradeBook lists them (not when written
          inside course content).
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
