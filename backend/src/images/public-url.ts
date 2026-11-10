import { configuredApiUrl } from '@/config/origins';
import { objectKey } from '@/storage/keys';
import { trimTrailingSlashes } from '@/common/trim-slashes';

/**
 * The URL clients load an image from: the CDN when S3_PUBLIC_URL is set, else
 * this API at API_URL. `requestOrigin` (built from the Host header) is only a
 * development fallback; production requires API_URL at boot and ignores it,
 * so a forged Host can never end up in a stored avatar URL.
 */
export function publicImageUrl(path: string, requestOrigin?: string): string {
  const cdn = (process.env.S3_PUBLIC_URL ? trimTrailingSlashes(process.env.S3_PUBLIC_URL) : undefined);
  if (cdn) return `${cdn}/${objectKey('images', path)}`;
  const fromRequest =
    process.env.NODE_ENV === 'production'
      ? undefined
      : requestOrigin === undefined ? undefined : trimTrailingSlashes(requestOrigin);
  const api =
    configuredApiUrl() ||
    fromRequest ||
    'http://localhost:3001';
  return `${api}/api/${objectKey('images', path)}`;
}

/** `publicImageUrl` for a nullable stored key; null stays null. */
export function optionalImageUrl(path: string | null | undefined): string | null {
  return path ? publicImageUrl(path) : null;
}
