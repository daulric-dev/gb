export function v1Uploaded(raw: { avatar_url: string }) {
  return {
    avatar_url: raw.avatar_url,
  };
}

export function v1Resumable(raw: {
  path: string;
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}) {
  return {
    path: raw.path,
    method: raw.method,
    uploadUrl: raw.uploadUrl,
    headers: raw.headers,
    expiresAt: raw.expiresAt,
  };
}
