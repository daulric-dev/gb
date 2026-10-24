import { api, buildUrl } from "@/lib/api";

/**
 * Direct uploads from the app to object storage with a presigned URL.
 *
 * Same three steps as the web client, because it is the same API: the backend
 * issues a ticket (a reserved file row and a short-lived signed URL), the
 * bytes are PUT straight to storage, then the backend checks what landed and
 * releases the file. Nothing is readable until it does.
 *
 * The picked document arrives as a `file://` URI rather than a File, so it is
 * read into a Blob first. Uploads are capped at 10MB server-side, which keeps
 * that affordable. XMLHttpRequest rather than fetch, because only XHR reports
 * upload progress in React Native.
 */

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
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

async function readBlob(file: PickedFile): Promise<Blob> {
  const response = await fetch(file.uri);
  return response.blob();
}

function putOnce(
  blob: Blob,
  ticket: UploadTicket,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method ?? "PUT", ticket.uploadUrl);
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

    xhr.send(blob);
  });
}

/** PUT the bytes, retrying once if the connection drops. */
async function sendToStorage(
  blob: Blob,
  ticket: UploadTicket,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  try {
    await putOnce(blob, ticket, onProgress);
  } catch (err) {
    if (!(err instanceof UploadError) || err.status !== 0) throw err;
    onProgress?.(0);
    await putOnce(blob, ticket, onProgress);
  }
}

/**
 * Attach a file to an assignment draft.
 *
 * Students hold no file permissions of their own, so the ticket is issued
 * against the activity rather than the file manager.
 */
export async function uploadSubmissionFile(
  activityId: string,
  file: PickedFile,
  onProgress?: (fraction: number) => void,
): Promise<{ fileId: string; name: string }> {
  const blob = await readBlob(file);

  const ticket = await api<UploadTicket>(
    `/portal/me/activities/${activityId}/upload-ticket`,
    {
      method: "POST",
      body: {
        name: file.name,
        sizeBytes: blob.size || file.size,
        contentType: file.mimeType,
      },
    },
  );

  await sendToStorage(blob, ticket, onProgress);

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
