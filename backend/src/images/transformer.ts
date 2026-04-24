export function v1Uploaded(raw: { avatar_url: string }) {
  return {
    avatar_url: raw.avatar_url,
  };
}

export function v1Resumable(raw: {
  path: string;
  token: string;
  signedUrl: string;
  tusEndpoint: string;
  tusHeaders: Record<string, string>;
  tusMetadata: Record<string, string>;
  chunkSize: number;
}) {
  return {
    path: raw.path,
    token: raw.token,
    signed_url: raw.signedUrl,
    tus_endpoint: raw.tusEndpoint,
    tus_headers: raw.tusHeaders,
    tus_metadata: raw.tusMetadata,
    chunk_size: raw.chunkSize,
  };
}
