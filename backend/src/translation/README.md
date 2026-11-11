# Machine translation (`src/translation`)

Machine translation of the interface and course content through the **organisation's chosen translation engine**, using the [`translate`](https://github.com/franciscop/translate) package (3.1.1, MIT, no dependencies). Behind the feature `translation` (off by default; the organisation turns it on and configures the engine, a school can switch it off). Structured like `src/ai` (organisation settings, encrypted key, step-up, audit, feature guard).

## HTTP routes

### Organisation console (`OrganisationTranslationController`)

`AuthGuard` + `OrganisationAdminGuard` + `TranslationOrgFeatureGuard` (`FeatureService.assertEnabled(null, 'translation')`: the organisation's own setting; 403 `FEATURE_DISABLED` while off).

| Method | Path | Step-up | What it does |
| --- | --- | --- | --- |
| GET | `/api/organisation/translation` | | `{ engine, url, hasKey, allowPrivateNetwork, enabled, updatedAt }`. Never the key. Without saved settings: `{ engine: 'google', url: null, hasKey: false, allowPrivateNetwork: false, enabled: false, updatedAt: null }`. |
| PUT | `/api/organisation/translation` | yes | `{ engine: 'google' \| 'deepl' \| 'libre' \| 'yandex', url?: string \| null, key?: string \| null, allowPrivateNetwork?: boolean, enabled: boolean }` → the GET shape. `key`: omitted = keep (only while the engine stays the same: a key belongs to its engine, so changing engine without a new key clears it), `null` or empty = clear, a value = replace. `url` is LibreTranslate only (stored null for the other engines; omitted keeps the saved one); it must be `https` (or `http` with `allowPrivateNetwork`), without user name, password, query or fragment; a server address (`https://libre.example.org`) has `/translate` added. 400 when `enabled` and DeepL / Yandex has no key, or LibreTranslate has no URL. Audited as `translation_setting` (`engine`, `url`, `allow_private_network`, `enabled`, `api_key_changed` / `api_key_cleared`, never the key). |
| POST | `/api/organisation/translation/test` | | Translates "Hello" into Spanish with the **saved** settings (never an address from the request body), bypassing the cache: `{ ok: true, sample }` or `{ ok: false, message }` (no settings, unreadable key, refused address, engine error with its HTTP status). Works while `enabled` is false, so an admin can test before switching it on. Throttled to 10 a minute. |

### Everyone signed in (`TranslationController`, `AuthGuard`)

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/translation/status` | `{ enabled }`: true only when the `translation` feature is on for the caller's active school (a student's own school; the organisation's value without one) **and** the organisation's settings are saved with `enabled` (and the key is readable). |
| POST | `/api/translation` | `{ texts: string[], to: string, from?: string }` → `{ translations: string[] }`, same order and length. Limits: ≤ 200 texts, each ≤ 5,000 characters, ≤ 50,000 in total (400). `to` / `from` are ISO 639-1; a region or script is dropped (`zh-CN` → `zh`, `pt-BR` → `pt`; anything else is a 400). No `from` = the engine detects the language. Empty, whitespace-only and letter-free strings (numbers, symbols) come back unchanged without reaching the engine; leading and trailing whitespace is kept. 403 `FEATURE_DISABLED` while off (as above); 409 `TRANSLATION_KEY_UNREADABLE`; 502 `TRANSLATION_FAILED` when the engine fails (nothing partial). Throttled to 300 a minute per session (the named `route` throttler). |

### Teachers (`ActivityTranslationController`, `AuthGuard`)

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/courses/:courseId/activities/:activityId/translate` | `{ to }` → a **new draft** copy of the assignment, quiz or offline activity in the same course, in the shape `GET /api/activities/:id` returns (activity fields plus `questions` and `bankDraws`). Title, instructions, question prompts, option labels and matching answers are machine-translated (source language detected); the title gets the language's English name in brackets (`Fractions quiz [Spanish]`, cut to 200 characters). Course teachers and admins only (`MANAGE_ROLES`, checked before anything is sent; an activity of another course is a 404); `translation` must be on for the **course's** school. Throttled to 5 a minute. |

The copy is made by `ActivityService.sourceForCopy` / `createCopy` (`src/grading`): same points, dates, late policy, submission types, attempts, time limit, shuffle and lockdown settings, assignment group, rubric (shared, not copied), answer keys (`is_correct`, numeric answers, partial credit) and question-bank draws (the banks themselves are not translated). Never submissions, answers, marks, extensions, accommodations, peer-review settings, outcome alignments or module placement. Audited as an `activity` create with `copiedFrom`. Instructions are sent as they are (Markdown or HTML may come back slightly altered: the teacher reviews the draft).

## Engines

| Engine | Key | Notes |
| --- | --- | --- |
| `google` | none | Google's **unofficial** `translate.googleapis.com` "gtx" endpoint (what the package uses). Free and keyless, but rate-limited, may break or be blocked without notice, and sends the content to Google. Fine for trying it out; not recommended for production. |
| `deepl` | required | DeepL API. Our own engine definition: `POST https://api.deepl.com/v2/translate` (`api-free.deepl.com` for keys ending `:fx`) with `Authorization: DeepL-Auth-Key <key>` and a form body (the package's own DeepL engine puts the key in the query string, which DeepL retired). |
| `libre` | optional (server-dependent) | LibreTranslate at the organisation's `url`. **Recommended: self-host it** (nothing leaves your network) and turn on `allowPrivateNetwork` if it runs inside your network. |
| `yandex` | required | Yandex Translate v1.5 as the package implements it (the key travels in the query string; that is Yandex's API). |

**Recommendation:** a self-hosted LibreTranslate (content stays with you) or DeepL (a contract and data-processing terms). Use `google` only for evaluation.

## Privacy: what leaves the server

- **Only text a user is viewing** that the client asks to translate: interface text and the course content on screen (activity titles and instructions, pages, announcements and similar). The client never sends **form inputs** (what someone is typing, answers, submissions, messages being written). The API translates whatever strings it is given, so this is a client rule; the backend's own use (the activity copy) sends only teacher-written activity text.
- It goes to the engine the organisation chose: Google, DeepL, Yandex or the LibreTranslate server at `url`. With `google`, content goes to Google through an unofficial endpoint without any agreement.
- Nothing is sent for a school with `translation` off, or while the organisation's settings are disabled.
- Translations are cached (below), keyed by a hash; the cached value is the translated text. Logs never contain the text or a Google / Yandex URL (which would contain it): engine failures are logged as `code=… status=…` only.

## Design

- **Settings:** `public.translation_setting` (migration `20261203100000_translation`), one row (`id` always true). The key is AES-256-GCM through `src/account/secret-box.ts` (info `gradebook:translation-key:v1`, AAD `translation-setting`); `stored()` decrypts it only to call the engine, `hasKey` is all a client sees, and a key that no longer decrypts (server key changed) makes `/translation/status` false and the user routes 409 until it is entered again. `scripts/reencrypt-secrets.ts` does not rotate it yet (like the AI provider keys): enter it again after rotating `AUTH_SECRET` if it was stored without `DATA_ENCRYPTION_KEY`.
- **Engine call** (`translation-engine.ts`, `callEngine`): one `Translate({ engine, key, from, to, engines, cache })` call per text. We pass our own engine definitions (`engineDefinitions`), which reuse the package's URL building and parsing for Google and LibreTranslate and add an `AbortSignal` (15 s, `TRANSLATION_TIMEOUT_MS`), source-language detection (`sl=auto`, `source: auto`, no `source_lang`; the package itself only accepts ISO codes for `from`), the DeepL header auth above, `redirect: 'error'`, and a status check before parsing (`AUTH`, `RATE_LIMITED`, `HTTP_ERROR`, `BAD_RESPONSE`, `TIMEOUT`, `NO_KEY`). The package's own cache is process-wide and unbounded by default; each call gets a unique cache id and a 1 ms life so it never answers or grows.
- **Cache-aside** (`translateBatch`): each distinct trimmed text is looked up in `CacheService` (Redis when `USE_REDIS=true`, else memory) under `translation:<sha256(engine|url|from|to|text)>` (`from` is `auto` when detected); only misses reach the engine; results are stored for 30 days. Another engine, LibreTranslate server or language pair is another key.
- **Batching:** misses are joined with `\n` into as few calls as the engine allows (`planJobs`): Google and Yandex (text in the URL) ≤ 1,800 URL-encoded characters per call, DeepL and LibreTranslate ≤ 4,500 characters, ≤ 50 strings per call. The answer is split on `\n`; if the number of lines differs, those strings are sent again one per call. A string with its own line breaks is sent alone; one over the per-call size is cut at sentence ends, then spaces, then characters (`splitLong`) and the pieces translated in turn. At most 4 calls run at once per request. The first failure stops the request (502); results that arrived before it are already cached.

## SSRF (LibreTranslate)

LibreTranslate is the only engine reached at an address the organisation chooses (Google, DeepL and Yandex are fixed public hosts). The address is checked on save (`checkLibreUrl`: http(s) only, `https` unless `allowPrivateNetwork`, no user name or password, no query or fragment) and again **before every call** (`assertLibreDestination`): every address the host resolves to goes through the webhook destination resolver (`resolveWebhookDestinations`, `src/integrations/delivery/webhook-destination.ts`) with an explicit `allowPrivate` = the setting, so private, loopback, link-local and reserved addresses are refused unless the organisation allowed its private network (`WEBHOOK_ALLOW_PRIVATE` is never consulted). The test route uses the saved address only. A refused address is never fetched.

**Residual risk: DNS rebinding.** The package sends requests with the global `fetch`, which resolves the host name again when it connects. A host that answers our check with a public address and the connection with a private one (a short-TTL rebinding attack) can still reach an internal address in that window. Unlike webhooks and AI providers (`safeWebhookFetch` pins the checked IP to the connection), the package gives us no hook to pin it. Exposure is limited: only an organisation admin (with step-up) sets the URL, every engine request is sent with `redirect: 'error'` (a redirect fails the call instead of reaching an unchecked address), and only the `translatedText` field of a JSON answer is ever used (no other response body is returned). To remove the risk entirely, use a LibreTranslate address that is an IP literal, or self-host it on the private network with `allowPrivateNetwork` on.

## Files

| File | What |
| --- | --- |
| `translation.constants.ts` | Engines, limits, cache TTL, per-call sizes, ISO 639-1 list, `normaliseLanguage`, `languageName`. |
| `translation-engine.ts` | `callEngine`, engine definitions (DeepL header auth), LibreTranslate URL checks. |
| `translation.service.ts` | `translateBatch` (cache, batching, fallback, whitespace), limits, status, `/translation`, the test. |
| `translation-settings.service.ts` | The organisation's settings (encrypted key, audit). |
| `activity-translation.service.ts` | The translated activity copy. |
| `translation.controller.ts`, `translation-feature.guard.ts`, `translation.dto.ts`, `translation.module.ts` | Routes, guards, DTOs. |
| `translation.test.ts` | Limits, batching and fallback, cache, DeepL auth, SSRF, feature switch, settings, routes and throttles, the copy. |
