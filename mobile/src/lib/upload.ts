import { api, buildUrl } from "@/lib/api";
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

function putOnce(
  bytes: ArrayBuffer,
  ticket: UploadTicket,
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
  ticket: UploadTicket,
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

/**
 * Attach a file to an assignment draft.
 *
 * Students hold no file permissions of their own, so the ticket is issued
 * against the activity rather than the file manager.
 */
export async function uploadSubmissionFile(activityId: string, file: PickedFile, onProgress?: (fraction: number) => void): Promise<{ fileId: string; name: string }> {
  const bytes = await readFile(file);

  const ticket = await api<UploadTicket>(
    `/portal/me/activities/${activityId}/upload-ticket`,
    {
      method: "POST",
      body: {
        name: file.name,
        sizeBytes: bytes.byteLength,
        contentType: file.mimeType || "application/octet-stream",
      },
    },
  );

  await sendToStorage(bytes, ticket, onProgress);

  // The check runs here, so a rejected file throws with the reason.
  return api<{ fileId: string; name: string }>(
    `/portal/me/activities/${activityId}/upload-ticket/${ticket.fileId}/complete`,
    { method: "POST" },
  );
}

/** Where a submitted file can be fetched from, for anything that needs a URL. */
export function submissionFileUrl(submissionId: string): string {
  return buildUrl(`/activities/submissions/${submissionId}/file`);
}
