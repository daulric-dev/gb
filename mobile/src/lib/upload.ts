import * as tus from "tus-js-client";
import { api, buildUrl } from "@/lib/api";

/**
 * Resumable uploads (TUS) from the app, straight to Supabase Storage.
 *
 * Same three steps as the web client, because it is the same API: the backend
 * issues a ticket, the bytes go to Storage, then the backend scans what landed
 * and releases the file. Nothing is readable until it does.
 *
 * The picked document arrives as a `file://` URI rather than a File, so it is
 * read into a Blob first. Uploads are capped at 10MB server-side, which keeps
 * that affordable, and it means the upload itself is byte-for-byte the same
 * code path the browser takes.
 */

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

interface UploadTicket {
  fileId: string;
  endpoint: string;
  token: string;
  bucket: string;
  objectName: string;
  contentType: string;
  chunkSize: number;
}

async function readBlob(file: PickedFile): Promise<Blob> {
  const response = await fetch(file.uri);
  return response.blob();
}

function sendToStorage(
  blob: Blob,
  ticket: UploadTicket,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: ticket.endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      metadata: {
        bucketName: ticket.bucket,
        objectName: ticket.objectName,
        contentType: ticket.contentType,
      },
      headers: { Authorization: `Bearer ${ticket.token}` },
      // Supabase Storage requires exactly this chunk size.
      chunkSize: ticket.chunkSize,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: () => Promise.resolve(`tus:${ticket.fileId}`),
      onProgress: (sent, total) => onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
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

  // The scan runs here, so a rejected file throws with the reason.
  return api<{ fileId: string; name: string }>(
    `/portal/me/activities/${activityId}/upload-ticket/${ticket.fileId}/complete`,
    { method: "POST" },
  );
}

/** Where a submitted file can be fetched from, for anything that needs a URL. */
export function submissionFileUrl(submissionId: string): string {
  return buildUrl(`/activities/submissions/${submissionId}/file`);
}
