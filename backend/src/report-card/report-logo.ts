/**
 * The school logo for report PDFs. pdf-lib embeds PNG and JPEG only, so any
 * other raster the image pipeline accepts (today WebP) is converted to PNG
 * first, with `sharp` when it is installed. sharp is not a backend
 * dependency (it is a large native package): it is loaded at run time if
 * the deployment provides it. Without it, or when conversion fails, the logo
 * is left off and the reason logged; the report itself is never affected.
 */

import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import { type ReportLogo, logoType } from './report-pdf';

const logger = new Logger('ReportLogo');

/** Largest side, in pixels, of a converted logo (it is drawn at 56 pt). */
export const CONVERTED_LOGO_MAX_PX = 512;

/** Converts image bytes to PNG; throws when it cannot. */
export type ToPng = (bytes: Uint8Array) => Promise<Uint8Array>;

interface SharpLike {
  (input: Buffer, options?: { limitInputPixels?: number; failOn?: string }): {
    resize(w: number, h: number, o: { fit: 'inside'; withoutEnlargement: boolean }): ReturnType<SharpLike>;
    png(): { toBuffer(): Promise<Buffer> };
  };
}

let sharpConverter: Promise<ToPng | null> | undefined;

/** sharp, if the deployment has it; resolved once. */
export function sharpToPng(): Promise<ToPng | null> {
  sharpConverter ??= Promise.resolve().then((): ToPng | null => {
    try {
      const mod = createRequire(__filename)('sharp') as SharpLike | { default: SharpLike };
      const sharp = typeof mod === 'function' ? mod : mod.default;
      return async (bytes: Uint8Array) =>
        new Uint8Array(
          await sharp(Buffer.from(bytes), { limitInputPixels: 50_000_000, failOn: 'error' })
            .resize(CONVERTED_LOGO_MAX_PX, CONVERTED_LOGO_MAX_PX, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer(),
        );
    } catch {
      return null;
    }
  });
  return sharpConverter;
}

/** RIFF....WEBP */
export function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}

let warnedNoSharp = false;

/**
 * The logo ready to embed: PNG and JPEG as they are, WebP converted to PNG,
 * anything else (or a failed conversion) null.
 */
export async function logoForPdf(
  bytes: Uint8Array,
  convert: () => Promise<ToPng | null> = sharpToPng,
): Promise<ReportLogo | null> {
  const type = logoType(bytes);
  if (type) return { bytes, type };
  if (!isWebp(bytes)) {
    logger.warn('School logo left off the report: not a PNG, JPEG or WebP image');
    return null;
  }
  const toPng = await convert();
  if (!toPng) {
    if (!warnedNoSharp) {
      warnedNoSharp = true;
      logger.warn('WebP school logos are left off report PDFs: install `sharp` in the backend to convert them');
    }
    return null;
  }
  try {
    const png = await toPng(bytes);
    if (logoType(png) !== 'png') throw new Error('the converter did not return a PNG');
    return { bytes: png, type: 'png' };
  } catch (error) {
    logger.warn(`School logo left off the report: WebP conversion failed (${(error as Error).message})`);
    return null;
  }
}
