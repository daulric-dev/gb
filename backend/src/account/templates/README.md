# Account email templates (`src/account/templates`)

This folder holds the emails the account module sends. The templates are TypeScript functions rather than files on disk, so they ship inside the build on every host. Serverless and Workers deployments have no filesystem to read templates from.

## Files

| File | Defines | Used by |
|------|---------|---------|
| `sign-in-code.ts` | `signInCodeEmail(code)` returns `{ subject, text, html }` for the "Your GradeBook sign-in code" email. The HTML version is table-based, with inline styles and a hidden preheader. The text version says the code expires in 10 minutes and can only be used once. | `EmailCodeService.send()` in `../email-code.service.ts`, which spreads the result into `MailService.send({ to, ...signInCodeEmail(code) })`. |

## Adding a template

1. Add `<name>.ts` here that exports a function taking the dynamic values and returning `{ subject, text, html }`. That is the shape `MailService.send()` accepts, along with `to`.
2. Keep the styles inline and the layout table-based, like `sign-in-code.ts`, because many email clients drop `<style>` blocks.
3. Import the function from the service that sends the email.
