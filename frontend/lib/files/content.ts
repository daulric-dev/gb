import { buildUrl } from "@/lib/api";

/**
 * Fetch a file's bytes from the backend. `content` is the view-only inline
 * stream (no signed URL is exposed); `download` is gated to owners and
 * recipients with download rights. Auth rides on the session cookie.
 */
export async function fetchFileBlob(
  fileId: string,
  mode: "content" | "download",
): Promise<Blob> {
  const res = await fetch(buildUrl(`/files/${fileId}/${mode}`), {
    headers: { "X-API-Version": "1" },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to load file (${res.status})`);
  }
  return res.blob();
}
