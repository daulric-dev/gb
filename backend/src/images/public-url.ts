import { objectKey } from '@/storage/keys';

export function publicImageUrl(path: string, requestOrigin?: string): string {
  const cdn = process.env.S3_PUBLIC_URL?.replace(/\/+$/, '');
  if (cdn) return `${cdn}/${objectKey('images', path)}`;
  const api =
    process.env.API_URL?.replace(/\/+$/, '') ||
    requestOrigin?.replace(/\/+$/, '') ||
    'http://localhost:3001';
  return `${api}/api/${objectKey('images', path)}`;
}

/** `publicImageUrl` for a nullable stored key; null stays null. */
export function optionalImageUrl(path: string | null | undefined): string | null {
  return path ? publicImageUrl(path) : null;
}
