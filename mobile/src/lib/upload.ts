import { api, ApiError, buildUrl } from "@/lib/api";
import { File } from "expo-file-system";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

interface UploadTicket {
  fileId: string;
  method: "PUT";
  uploadUrl: string;
  /** Sent exactly as given: the signature covers them. */
  headers: Record<string, string>;
  expiresAt: string;
  contentType: string;
  maxBytes: number;
}

/** A failed transfer to storage (storage answers in XML, not API JSON). */
export class UploadError extends Error {
  constructor(
    message: string,
    /** HTTP status from storage; 0 when the request never completed. */
    public status: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

async function readFile(file: PickedFile): Promise<ArrayBuffer> {
  return new File(file.uri).arrayBuffer();
}

/** The part of a ticket the PUT to storage needs. */
type StorageTarget = Pick<UploadTicket, "method" | "uploadUrl" | "headers">;

function putOnce(
  bytes: ArrayBuffer,
  ticket: StorageTarget,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.uploadUrl);
    // A presigned URL on another host: no cookies, only the signed headers.
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(ticket.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new UploadError(`Upload failed (${xhr.status})`, xhr.status));
      }
    };
    const networkError = () =>
      reject(
        new UploadError("Upload failed. Check your connection and try again.", 0),
      );

    xhr.onerror = networkError;
    xhr.ontimeout = networkError;
    xhr.onabort = () => reject(new UploadError("Upload cancelled", 0));

    xhr.send(bytes);
  });
}

/** PUT the bytes, retrying once if the connection drops. */
async function sendToStorage(
  bytes: ArrayBuffer,
  ticket: StorageTarget,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  try {
    await putOnce(bytes, ticket, onProgress);
  } catch (err) {
    if (!(err instanceof UploadError) || err.status !== 0) throw err;
    onProgress?.(0);
    await putOnce(bytes, ticket, onProgress);
  }
}

/** Waits between attempts when the backend is too busy to check an upload. */
const BUSY_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Run `call`, retrying after each delay while it fails with 503. Completing
 * an upload answers 503 when the server is busy checking other uploads; the
 * file stays pending, so asking again is safe.
 */
async function retryWhileBusy<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const busy = err instanceof ApiError && err.status === 503;
      if (!busy || attempt >= BUSY_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Upload a file straight to storage with a presigned ticket, then have the
 * backend check and release it.
 *
 * `ticket` and `complete` differ by caller: the file manager issues its own
 * tickets, and the student portal issues them per assignment because students
 * hold no file permissions of their own.
 */
export async function uploadWithTicket<T>(
  file: PickedFile,
  paths: { ticket: string; complete: (fileId: string) => string },
  options: {
    name?: string;
    folderId?: string;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<T> {
  const bytes = await readFile(file);

  const ticket = await api<UploadTicket>(paths.ticket, {
    method: "POST",
    body: {
      name: options.name ?? file.name,
      sizeBytes: bytes.byteLength,
      contentType: file.mimeType || "application/octet-stream",
      ...(options.folderId ? { folderId: options.folderId } : {}),
    },
  });

  await sendToStorage(bytes, ticket, options.onProgress);

  // The check runs here, so a rejected file throws with the reason.
  return retryWhileBusy(() =>
    api<T>(paths.complete(ticket.fileId), { method: "POST" }),
  );
}

/**
 * Attach a file to an assignment draft.
 *
 * Students hold no file permissions of their own, so the ticket is issued
 * against the activity rather than the file manager.
 */
export async function uploadSubmissionFile(activityId: string, file: PickedFile, onProgress?: (fraction: number) => void): Promise<{ fileId: string; name: string }> {
  const base = `/portal/me/activities/${activityId}/upload-ticket`;
  return uploadWithTicket(
    file,
    { ticket: base, complete: (fileId) => `${base}/${fileId}/complete` },
    { onProgress },
  );
}

/** Upload a file to the caller's own files, optionally into one of their folders. */
export async function uploadMyFile(
  file: PickedFile,
  options: { folderId?: string; onProgress?: (fraction: number) => void } = {},
): Promise<{ id: string; name: string; status: string }> {
  return uploadWithTicket(
    file,
    {
      ticket: "/files/upload-ticket",
      complete: (fileId) => `/files/upload-ticket/${fileId}/complete`,
    },
    options,
  );
}

/** The avatar ticket: `path` is the staged object to name on completion. */
interface AvatarUploadTicket {
  path: string;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Set the signed-in user's profile picture: PUT the image straight to
 * storage, then have the backend check it (at most 5MB, JPEG, PNG or WebP)
 * and point the profile at it. Returns the new avatar URL.
 */
export async function uploadAvatar(file: PickedFile): Promise<string> {
  const bytes = await readFile(file);

  const ticket = await api<AvatarUploadTicket>("/auth/avatar/resumable", {
    method: "POST",
    body: {
      filename: file.name,
      contentType: file.mimeType,
      totalSize: bytes.byteLength,
    },
  });

  await sendToStorage(bytes, ticket);

  const { avatar_url } = await api<{ avatar_url: string }>("/auth/avatar/complete", {
    method: "POST",
    body: { path: ticket.path },
  });
  return avatar_url;
}

/** Where a submitted file can be fetched from, for anything that needs a URL. */
export function submissionFileUrl(submissionId: string): string {
  return buildUrl(`/activities/submissions/${submissionId}/file`);
}
