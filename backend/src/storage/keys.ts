/**
 * Every object lives in one S3 bucket under `<area>/<path>`, where the area is
 * the name of the bucket it used to have its own of (`file-manager`, `images`,
 * `report-books`). Rows keep storing (bucket, path) unchanged; this is the one
 * place the two are joined into a key.
 */
export function objectKey(bucket: string, path: string): string {
  return `${bucket}/${path.replace(/^\/+/, '')}`;
}
