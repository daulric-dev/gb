import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ApiError, buildUrl } from "@/lib/api";

/**
 * Download a file the API serves behind the session (a course file, a handed-in
 * submission) and hand it to the OS to preview or share.
 *
 * The browser cannot open these URLs on its own: the session cookie lives in
 * the app's networking stack, not Safari's. So the bytes are fetched here, with
 * the session, written to the cache directory, and the share sheet - which
 * includes Quick Look on iOS and "Open with" on Android - takes it from there.
 */
export async function downloadAndOpen(
  path: string,
  fallbackName = "file",
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      headers: { "X-API-Version": "1" },
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      (body as { message?: string } | null)?.message ?? "Could not open this file",
    );
  }

  const name = fileNameFrom(res.headers.get("content-disposition")) ?? fallbackName;
  const mimeType =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (Platform.OS === "web") {
    throw new Error("Opening files is only available in the app");
  }

  // One file per name: re-opening replaces the earlier copy.
  const file = new File(Paths.cache, safeName(name));
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("This device cannot open files");
  }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}

/** `inline; filename*=UTF-8''a%20b.pdf` or `inline; filename="a b.pdf"`. */
export function fileNameFrom(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(-120) || "file";
}
