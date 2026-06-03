import { ApiError, buildUrl } from "@/lib/api";

/** Trigger a browser "save as" download for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  // Prefer RFC 5987 filename*, fall back to plain filename="...".
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

/**
 * Fetch a file the backend generates (PDF/CSV/XLSX/zip) and save it. The
 * filename comes from the response's Content-Disposition when available,
 * otherwise `fallbackName`.
 */
export async function downloadFromUrl(path: string, fallbackName: string) {
  const res = await fetch(buildUrl(path), {
    headers: { "X-API-Version": "1" },
    credentials: "include",
  });

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, error.message || res.statusText, error);
  }

  const blob = await res.blob();
  const name =
    filenameFromDisposition(res.headers.get("content-disposition")) ??
    fallbackName;
  downloadBlob(blob, name);
}
