import { api, ApiError } from "@/lib/api";

/**
 * Direct uploads to object storage with a presigned URL.
 *
 * The bytes never pass through the API: the backend issues a ticket - a
 * reserved file row and a short-lived signed URL for the object it must be
 * written to - the browser PUTs the file there, then the backend checks what
 * landed and releases the file. Nothing is readable until it does.
 */

export interface UploadTicket {
  fileId: string;
  method: "PUT";
  uploadUrl: string;
  /** Sent exactly as given: the signature covers them. */
  headers: Record<string, string>;
  expiresAt: string;
  contentType: string;
  maxBytes: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: string;
}

/** A failed transfer to storage (not an API error - storage answers in XML). */
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

/** The part of a ticket the PUT to storage needs. */
type StorageTarget = Pick<UploadTicket, "method" | "uploadUrl" | "headers">;

function putOnce(
  file: Blob,
  ticket: StorageTarget,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method ?? "PUT", ticket.uploadUrl);
    // A presigned URL on another origin: no cookies, only the signed headers.
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

    xhr.send(file);
  });
}

/** PUT the bytes, retrying once if the connection drops. */
export async function sendToStorage(
  file: Blob,
  ticket: StorageTarget,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  try {
    await putOnce(file, ticket, onProgress);
  } catch (err) {
    if (!(err instanceof UploadError) || err.status !== 0) throw err;
    onProgress?.(0);
    await putOnce(file, ticket, onProgress);
  }
}

/** Waits between attempts when the backend is too busy to check an upload. */
export const BUSY_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Run `call`, retrying after each delay while it fails with 503. Completing
 * an upload answers 503 when the server is busy checking other uploads; the
 * file stays pending, so asking again is safe.
 */
export async function retryWhileBusy<T>(
  call: () => Promise<T>,
  delaysMs: readonly number[] = BUSY_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const busy = err instanceof ApiError && err.status === 503;
      if (!busy || attempt >= delaysMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/**
 * Upload a file and return it once the backend has released it.
 *
 * `ticket` and `complete` differ by caller: the file manager issues its own
 * tickets, and the student portal issues them per assignment because students
 * hold no file permissions of their own.
 */
export async function uploadFile(
  file: File,
  paths: {
    ticket: string;
    complete: (fileId: string) => string;
  },
  options: {
    name?: string;
    folderId?: string;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<UploadedFile> {
  const ticket = await api<UploadTicket>(paths.ticket, {
    method: "POST",
    body: {
      name: options.name ?? file.name,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
      ...(options.folderId ? { folderId: options.folderId } : {}),
    },
  });

  await sendToStorage(file, ticket, options.onProgress);

  // The check runs here, so a rejected file throws with the reason.
  return retryWhileBusy(() =>
    api<UploadedFile>(paths.complete(ticket.fileId), { method: "POST" }),
  );
}

/** The avatar ticket: `path` is the staged object to name on completion. */
export interface AvatarUploadTicket {
  path: string;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Set the signed-in user's profile picture: PUT the image straight to
 * storage, then have the backend check it and point the profile at it.
 * Returns the new avatar URL.
 */
export async function uploadAvatar(
  image: Blob,
  filename: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const ticket = await api<AvatarUploadTicket>("/auth/avatar/resumable", {
    method: "POST",
    body: {
      filename,
      contentType: image.type || "application/octet-stream",
      totalSize: image.size,
    },
  });

  await sendToStorage(image, ticket, onProgress);

  const { avatar_url } = await api<{ avatar_url: string }>(
    "/auth/avatar/complete",
    { method: "POST", body: { path: ticket.path } },
  );
  return avatar_url;
}
