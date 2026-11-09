import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  type PDFRawStream,
  PDFRef,
} from '@pdfme/pdf-lib';

function streamText(doc: PDFDocument, ref: PDFObject): string {
  const stream = (ref instanceof PDFRef ? doc.context.lookup(ref) : ref) as PDFRawStream;
  let data = Buffer.from(stream.getContents());
  if (stream.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode') data = inflateSync(data);
  return data.toString('latin1');
}

const hexChars = (hex: string) => {
  const codes: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) codes.push(parseInt(hex.slice(i, i + 4), 16));
  return String.fromCharCode(...codes);
};

/** A ToUnicode CMap as code -> text (bfchar and bfrange entries). */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(m[1], 16), hexChars(m[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexChars(x[1]));
        items.forEach((t, i) => map.set(lo + i, t));
      } else {
        const start = hexChars(m[3].slice(1, -1));
        const base = start.codePointAt(0)!;
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCodePoint(base + (c - lo)));
      }
    }
  }
  return map;
}

/** Font resource name -> ToUnicode map (null: a simple font, read as latin1). */
function pageFonts(doc: PDFDocument, resources: PDFDict | undefined): Map<string, Map<number, string> | null> {
  const out = new Map<string, Map<number, string> | null>();
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return out;
  for (const [name, ref] of fonts.entries()) {
    const font = doc.context.lookup(ref, PDFDict);
    const toUnicode = font.get(PDFName.of('ToUnicode'));
    out.set(name.toString(), toUnicode ? parseToUnicode(streamText(doc, toUnicode)) : null);
  }
  return out;
}

/**
 * Every string drawn with `Tj` in a PDF made by pdf-lib, page by page, one
 * per line: enough to assert a generated PDF says what it should. Standard
 * fonts are read as Latin-1; embedded (Identity-H) fonts through their
 * ToUnicode map. Loads the bytes with pdf-lib first, so it also proves the
 * PDF is valid.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    if (!contents) continue;
    const fonts = pageFonts(doc, page.node.Resources());
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      let current: Map<number, string> | null = null;
      for (const m of streamText(doc, ref).matchAll(/(\/[^\s/]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g)) {
        if (m[1]) {
          current = fonts.get(m[1]) ?? null;
          continue;
        }
        const hex = m[2];
        if (!current) {
          out.push(Buffer.from(hex, 'hex').toString('latin1'));
          continue;
        }
        let text = '';
        for (let i = 0; i + 4 <= hex.length; i += 4) text += current.get(parseInt(hex.slice(i, i + 4), 16)) ?? '\uFFFD';
        out.push(text);
      }
    }
  }
  return out.join('\n');
}

/** The base font names a PDF uses (e.g. "Helvetica", "NotoSans-Regular-1234"). */
export async function pdfFontNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const names = new Set<string>();
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      const base = doc.context.lookup(ref, PDFDict).get(PDFName.of('BaseFont'));
      if (base) names.add(base.toString().replace(/^\//, ''));
    }
  }
  return [...names];
}
