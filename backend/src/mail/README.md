# Mail (`src/mail`)

Outgoing email over SMTP, through `nodemailer`. Any SMTP server works. There are presets for the big providers (Gmail, Outlook/Office 365, Yahoo, iCloud, Zoho), which only need a username and an app password. Today the only email the API sends is the sign-in code.

## What it provides

- **HTTP routes**: none.
- **Services / exports**
  - `MailModule` is `@Global()` and exports `MailService`.
  - `MailService.send({ to, subject, text, html? })` sends one message from the configured From address and logs the subject with a redacted recipient (`j***@school.edu`). It throws if SMTP is not configured or the send fails.
  - `MailService.onModuleInit()` checks the SMTP login once at boot (`transporter.verify()`), except when `NODE_ENV=test` or nothing is configured. A failure is only a warning that reminds you to use an app password; the API still starts.
- **Other** (`mail.config.ts`, pure functions that read an env object, `process.env` by default)
  - `smtpOptions(env)` builds the transport options, or returns null when nothing is configured. `SMTP_URL` wins over the separate fields. An unknown `SMTP_SERVICE` or an invalid `SMTP_PORT` throws.
  - `mailFrom(env)` gives the From address: `MAIL_FROM`, else `GradeBook <SMTP_USER>` when the user is an email address, else `GradeBook <no-reply@localhost>`.
  - `SMTP_PRESETS`: the host and port for each named service.

  Two rules in `smtpOptions` are easy to miss:
  - For Gmail, Yahoo and iCloud the spaces in an app password (`abcd efgh ijkl mnop`) are stripped, because the login fails with them.
  - When credentials are set and the connection is not implicit TLS, `requireTLS` is on, so the password is never sent in plain text. `SMTP_ALLOW_INSECURE=true` turns that off.

## Used by

- `src/account/email-code.service.ts` injects `MailService` and calls `send()` with `signInCodeEmail(code)` for email sign-in codes.
- `src/app.module.ts` imports `MailModule`.

## Depends on

`nodemailer`. No other modules.

## Data

None.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMTP_URL` | unset | Whole connection as a URL, e.g. `smtps://user:pass@host:465`. The password must be URL-encoded. Wins over everything below. |
| `SMTP_SERVICE` | unset | Preset: `gmail`, `google`, `outlook`, `office365`, `yahoo`, `icloud`, `zoho` |
| `SMTP_HOST` | the preset's host | SMTP host; overrides the preset |
| `SMTP_PORT` | the preset's port, else `587` | SMTP port |
| `SMTP_SECURE` | on for port 465, else off (STARTTLS) | Force implicit TLS on or off (`1/true/yes/on`) |
| `SMTP_USER` | unset | Login user; also the default From address |
| `SMTP_PASSWORD` | unset | Login password (an app password for the big providers) |
| `SMTP_PASSWORD_FILE` | unset | Read the password from a file instead (a mounted secret); a trailing newline is trimmed |
| `SMTP_ALLOW_INSECURE` | `false` | Allow sending credentials without TLS |
| `MAIL_FROM` | see `mailFrom()` | From address |
| `NODE_ENV` | | `test` skips the boot-time SMTP check |

With no `SMTP_URL` and no host (directly or from a preset), email is not configured and `send()` throws. `backend/.env.example` points `SMTP_URL` at a local catcher on `127.0.0.1:1025` for development.

## Files

| File | Purpose |
| --- | --- |
| `mail.module.ts` | Global module exporting `MailService` |
| `mail.service.ts` | Lazily created nodemailer transport, boot-time check, `send()` |
| `mail.config.ts` | `smtpOptions()`, `mailFrom()`, `SMTP_PRESETS` |
| `mail.config.test.ts` | Tests for the config functions |

## Tests

`cd backend && bun test src/mail`. Covers `smtpOptions` (URL precedence, presets, unknown services, port validation, secure and `requireTLS` defaults, app-password space stripping, the password file) and `mailFrom` defaults.

## See also

- [`docs/content/backend/auth.md`](../../../docs/content/backend/auth.md): the sign-in code flow that sends email
