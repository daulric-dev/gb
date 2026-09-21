import * as tus from "tus-js-client";
import { api } from "@/lib/api";

/**
 * Resumable uploads (TUS) straight to Supabase Storage.
 *
 * The bytes no longer pass through the API: the backend issues a ticket -
 * a reserved file row, the object path it must be written to, and a
 * short-lived token - the browser uploads to Storage, then the backend scans
 * what landed and releases the file. Nothing is readable until it does.
 *
 * A dropped connection resumes from where it stopped rather than starting the
 * file again, which is the point of the exercise.
 */

export interface UploadTicket {
  fileId: string;
  endpoint: string;
  token: string;
  expiresAt: string;
  bucket: string;
  objectName: string;
  contentType: string;
  chunkSize: number;
}

export interface ResumableFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: string;
}

/** Keyed per file so a reload can pick an interrupted upload back up. */
const storageKey = (ticket: UploadTicket) => `tus:${ticket.fileId}`;

function sendToStorage(
  file: File,
  ticket: UploadTicket,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: ticket.endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // Storage keys the upload by this metadata, not by the file name.
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
      fingerprint: () => Promise.resolve(storageKey(ticket)),
      onProgress: (sent, total) => onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });

    // Resume rather than restart when this file was already part-way up.
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
 * Upload a file resumably and return it once the backend has released it.
 *
 * `ticketPath` and `completePath` differ by caller: the file manager issues
 * its own tickets, and the student portal issues them per assignment because
 * students hold no file permissions of their own.
 */
export async function uploadResumable(
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
): Promise<ResumableFile> {
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

  // The scan runs here, so a rejected file throws with the reason.
  return api<ResumableFile>(paths.complete(ticket.fileId), { method: "POST" });
}
