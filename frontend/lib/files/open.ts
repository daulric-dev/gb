import { downloadBlob } from "@/lib/download";

/**
 * Types a browser renders without running script. Anything else (HTML, SVG,
 * XML...) would execute on the app's origin once wrapped in a blob: URL, which
 * drops the API's `Content-Security-Policy: sandbox`.
 */
const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** The bare, lower-cased media type, without parameters. */
export function mediaType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/** Whether a file of this type may be opened in a tab instead of downloaded. */
export function isInlineSafeType(type: string | null | undefined): boolean {
  return INLINE_TYPES.has(mediaType(type));
}

/**
 * Re-type a blob for opening: an inline-safe type is pinned to exactly that
 * type, everything else becomes `application/octet-stream` so the browser can
 * only save it, never render it.
 */
export function retypeForOpen(blob: Blob): { blob: Blob; inline: boolean } {
  const type = mediaType(blob.type);
  if (INLINE_TYPES.has(type)) {
    return { blob: new Blob([blob], { type }), inline: true };
  }
  return {
    blob: new Blob([blob], { type: "application/octet-stream" }),
    inline: false,
  };
}

/**
 * Open a file in a new tab when it is a PDF or plain image, otherwise download
 * it. The tab is opened synchronously so popup blockers allow it, then pointed
 * at the file once the bytes arrive (or closed, if the file downloads instead).
 * Rejects if `load` does.
 */
export async function openOrDownloadFile(
  load: () => Promise<Blob>,
  filename: string,
): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const { blob, inline } = retypeForOpen(await load());
    if (!inline) {
      win?.close();
      downloadBlob(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/**
 * `url` when it is an absolute http(s) URL, else null — so a stored
 * `javascript:` or `data:` link is never rendered as an href.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:" ? url.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Strip every link in `root` whose href is not http(s) or mailto, and open the
 * external ones in a new tab without an opener. For HTML rendered from
 * untrusted documents (e.g. DOCX previews), where hrefs come straight from the
 * file.
 */
export function sanitizeLinks(root: ParentNode): void {
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const raw = a.getAttribute("href") ?? "";
    let protocol: string | null = null;
    try {
      protocol = new URL(raw.trim()).protocol;
    } catch {
      protocol = null;
    }
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      if (protocol !== "mailto:") {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
      continue;
    }
    a.removeAttribute("href");
  }
}
