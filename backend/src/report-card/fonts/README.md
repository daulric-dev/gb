# Report PDF fonts

Noto Sans Regular and Bold, used by `../report-fonts.ts` for report card and
transcript PDFs (embedded as a subset). They cover Latin (including Latin
Extended and Vietnamese), Greek and Cyrillic.

| File | SHA-256 |
| --- | --- |
| `NotoSans-Regular.ttf` | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` |
| `NotoSans-Bold.ttf` | `87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9` |
| `OFL.txt` | `cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a` |

## Source

The official Noto release **`NotoSans-v2.015`** (20 November 2024) from
[notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSans-v2.015):
`NotoSans-v2.015.zip` (SHA-256
`0c34df072a3fa7efbb7cbf34950e1f971a4447cffe365d3a359e2d4089b958f5`), files
`NotoSans/unhinted/ttf/NotoSans-Regular.ttf`,
`NotoSans/unhinted/ttf/NotoSans-Bold.ttf` and `OFL.txt`, unchanged. The
unhinted build is used: hinting is irrelevant in a PDF and it is a third
smaller.

To check them:

```bash
cd backend/src/report-card/fonts && shasum -a 256 *.ttf OFL.txt
```

To update, download the release zip by its exact tag, extract the same
three files, and update the table above.

## License

SIL Open Font License 1.1 (`OFL.txt`). Embedding the fonts (or a subset) in
generated PDFs is allowed by the license; the files may be bundled with the
software as long as `OFL.txt` stays beside them. "Noto" is a trademark of
Google LLC; the fonts are not modified or renamed here.

## More scripts

These fonts do not cover Chinese, Japanese, Korean, Arabic, Hebrew,
Devanagari and other scripts. Such characters are drawn as a replacement
character (and logged once per PDF) unless `REPORT_PDF_EXTRA_FONT` names an
extra TrueType/OpenType font file (not a `.ttc` collection) on the server,
for example `NotoSansSC-Regular.ttf` or `NotoNaskhArabic-Regular.ttf`.
pdf-lib does not position marks or reorder mixed-direction lines, so check a
sample PDF before relying on it for right-to-left or complex scripts.
