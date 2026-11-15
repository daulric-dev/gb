import type { TranslationEngine } from './translation.constants';

/**
 * Engines with no data-processing agreement behind them: Google (the
 * unofficial, keyless endpoint: no contract at all, US) and Yandex (Russia:
 * no EU adequacy decision, no standard contractual clauses for this API).
 * They are refused (saving them switched on, and using a saved one) unless
 * the server explicitly allows them with
 * `TRANSLATION_ALLOW_UNCONTRACTED_ENGINES=true`.
 */
export const UNCONTRACTED_ENGINES: ReadonlySet<TranslationEngine> = new Set(['google', 'yandex']);

/** `TRANSLATION_ALLOW_UNCONTRACTED_ENGINES=true` (exactly; anything else is off). */
export function uncontractedEnginesAllowed(): boolean {
  return process.env.TRANSLATION_ALLOW_UNCONTRACTED_ENGINES?.trim().toLowerCase() === 'true';
}

/** Whether this server may send text to `engine`. */
export function engineAllowed(engine: TranslationEngine): boolean {
  return !UNCONTRACTED_ENGINES.has(engine) || uncontractedEnginesAllowed();
}

/** The message an organisation admin sees when a refused engine is saved switched on. */
export const UNCONTRACTED_ENGINE_MESSAGE =
  'Google and Yandex are not allowed on this server: neither has a data processing agreement for this use ' +
  '(Google through an unofficial endpoint in the US; Yandex in Russia, which has no EU adequacy decision). ' +
  'Use a self-hosted LibreTranslate server or DeepL. A server administrator can allow them with ' +
  'TRANSLATION_ALLOW_UNCONTRACTED_ENGINES=true.';

/**
 * The service's name as people are told it in the "Translate GradeBook
 * into …?" question: where their page text goes.
 */
export function engineDisplayName(engine: TranslationEngine, url: string | null, allowPrivateNetwork: boolean): string {
  switch (engine) {
    case 'google':
      return 'Google Translate';
    case 'deepl':
      return 'DeepL';
    case 'yandex':
      return 'Yandex Translate';
    case 'libre': {
      if (allowPrivateNetwork) return "LibreTranslate (your school's server)";
      let host: string | null;
      try {
        host = url ? new URL(url).hostname : null;
      } catch {
        host = null;
      }
      return host ? `LibreTranslate (${host})` : 'LibreTranslate';
    }
  }
}
