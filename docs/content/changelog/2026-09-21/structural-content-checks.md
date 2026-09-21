---
sidebar_label: 2026-09-21 · Structural content checks
sidebar_position: 2
---

# 2026-09-21 - Structural content checks on uploads

Uploads are now inspected **inside** the file, not just at its first four bytes. This closes the gaps left when [ClamAV was removed](./remove-clamav.md), without a scanner, a daemon or a third party.

Backend only. No migration, no new dependency, no configuration.

## The gap

`verifyContent` compared the declared type against the file's leading bytes. That is enough for an `.exe` renamed to `.pdf`, and not enough for anything else, because two of the accepted formats are containers:

- **Every OOXML file is a ZIP**, so `PK\x03\x04` is all a `.docx` had to prove. An arbitrary archive - including one holding an executable - was **accepted as a Word document**. So was a macro-enabled `.docm` renamed to `.docx`, even though the macro type is excluded from the allow-list.
- **A PDF carrying `/Launch` or `/JavaScript` starts with `%PDF`** like any other, so it was accepted.

Both were verified as accepted before the change, and are rejected after.

## What it checks

`inspectStructure` runs inside `verifyContent`, so both upload paths - single-request and resumable - are covered with no call-site changes.

### Office documents

The ZIP's **central directory** is walked to list the parts inside:

- `vbaProject.bin` anywhere in the archive → rejected as macro-enabled.
- No `[Content_Types].xml` → not an Office document at all.
- The part matching the declared type must exist: `word/document.xml` for a document, `xl/workbook.xml` for a workbook. A workbook uploaded as a document is rejected, and so is an archive that is neither.

Only the index is read - **nothing is decompressed** - so a crafted archive cannot make this expensive, and a zip bomb has nothing to inflate. An archive whose directory cannot be parsed is rejected rather than passed.

ZIP64 is not handled and does not need to be: uploads are capped at 10MB, far below the 4GB / 65535-entry threshold where it applies.

### PDFs

Rejected: `/Launch` (runs an external program), `/JavaScript` and `/JS`, and `/EmbeddedFile` (a carrier for a second payload).

**`/OpenAction` is deliberately allowed.** It appears in a large share of ordinary PDFs - open at a page, set a zoom - and rejecting it would refuse legitimate coursework daily. It is only dangerous in combination with the constructs above, which are rejected anyway. A test pins this, so the reasoning is visible to anyone who later thinks to "tighten" it.

## Effect

| File | Before | After |
| --- | --- | --- |
| Legitimate `.docx` coursework | accepted | accepted |
| Macro document renamed to `.docx` | accepted | rejected - *Macro-enabled documents are not accepted* |
| ZIP containing an `.exe`, declared `.docx` | accepted | rejected - *not a valid Office document* |
| Workbook uploaded as a document | accepted | rejected - *contents do not match the declared type* |
| Ordinary PDF | accepted | accepted |
| PDF with `/OpenAction` only | accepted | accepted |
| PDF carrying JavaScript | accepted | rejected - *contains JavaScript* |
| PDF with `/Launch` | accepted | rejected - *launches an external program* |

Rejections carry a reason the uploader can act on, and the resumable path records it on the file row before deleting the object.

## Limits

- **This is not malware detection.** It rejects files built to *run* something and files that are not the format they claim. A structurally clean document can still exploit a bug in whatever opens it.
- **The PDF scan reads raw bytes**, so a token inside a compressed object stream is not seen. It raises the cost of the common case rather than closing the format off.
- **Embedded OLE objects in Office files are not rejected.** They are a known vector, but also a legitimate feature, and refusing a student's submission is expensive. A candidate for tightening if it ever proves to be a problem in practice.

## Tests

11 new tests build **real ZIP archives byte by byte** rather than using fixtures, so the central-directory walk is exercised as itself - including the unreadable-archive path, which fails closed. Backend suite: 327 → 338.
