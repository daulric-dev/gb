---
sidebar_label: 2026-07-12 · Message encryption at rest
sidebar_position: 6
---

# 2026-07-12 - Chat message encryption at rest

Chat message content is now **encrypted at rest** with AES-256-GCM. A database dump, a leaked backup, or a direct SQL read yields ciphertext instead of readable messages. No migration (the ciphertext lives in the existing `body` column).

## What this is (and isn't)

Defense-in-depth on top of TLS in transit and Supabase's disk encryption. It is **not** end-to-end encryption: the server holds the key, because it must render conversation previews, unread counts, server-generated system messages, and the realtime stream — the same trust already placed in this backend for grades and PII. The win is that the **stored data is useless without the app key**, so a DB/backup leak or an RLS mistake no longer exposes message text.

## How it works

`MessageCipher` ([message-cipher.service.ts](../../../../backend/src/chat/message-cipher.service.ts)) encrypts with AES-256-GCM (random 12-byte IV per message + auth tag), hooked at three points in `ChatService`: `postMessage` and `editMessage` encrypt `body` before write; `presentMessage` decrypts on read (covering previews and every list/thread path).

- **Envelope**: `enc:v<version>:<iv>:<tag>:<ciphertext>`, stored in the existing `body` column — no schema change. A value without the `enc:` prefix is treated as legacy plaintext and passed through, so **turning encryption on doesn't break rows already in the DB**.
- **Keys** are base64 of 32 bytes, from the environment, and **versioned for rotation** — `CHAT_ENCRYPTION_KEY` (single → v1) or `CHAT_ENCRYPTION_KEYS` (`1:<b64>,2:<b64>`). New rows use the current version; old rows decrypt by the version baked into their envelope. Rotate by adding a new key and pointing `CHAT_ENCRYPTION_KEY_VERSION` at it.
- **Fail-closed**: in production a missing key **stops the app from booting**; in dev it logs a warning and stores plaintext. A tampered ciphertext fails GCM auth and yields no plaintext.

Scope: the message body is encrypted (including system-message captions like a shared file's name). System-message `metadata` keeps ids (`fileId`, `classId`) in plaintext — needed for navigation, not message content. The Redis bus carries decrypted events between the app and its SSE edges (internal/transient); the database is the encryption boundary.

## Operator action

Set `CHAT_ENCRYPTION_KEY` (`openssl rand -base64 32`) in every non-dev environment — the backend now refuses to start in production without it. See [Environment Variables](../../environment-variables.md).

## Tests

Added `message-cipher.service.test.ts` — round-trip, unique IV per encryption, legacy-plaintext passthrough, null/empty handling, tamper detection (GCM auth failure → no plaintext), and key rotation (new key encrypts, old key still decrypts). Backend suite: 256 → 263 tests, all passing.
