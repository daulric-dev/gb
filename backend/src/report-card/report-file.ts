import type { FastifyReply } from 'fastify';
import { contentDisposition } from '@/grading/content-disposition';

/**
 * Send a report PDF with the headers every served file gets: the real type,
 * a safe Content-Disposition, no caching by shared caches, no sniffing, and
 * a sandbox in case the PDF is opened directly on the API origin.
 */
export function sendPdf(
  res: FastifyReply,
  file: { body: unknown; filename: string; size?: number | null },
  disposition: 'inline' | 'attachment' = 'attachment',
) {
  if (file.size !== null && file.size !== undefined) res.header('Content-Length', file.size);
  return res
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', contentDisposition(disposition, file.filename))
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', 'sandbox')
    .send(file.body);
}

/** Bytes drawn on request (previews, transcripts). */
export function sendPdfBytes(
  res: FastifyReply,
  file: { bytes: Uint8Array; filename: string },
  disposition: 'inline' | 'attachment' = 'attachment',
) {
  const body = Buffer.from(file.bytes);
  return sendPdf(res, { body, filename: file.filename, size: body.length }, disposition);
}
