export const QUEUE_FILE_INGEST = 'file-ingest';
export const QUEUE_FILE_SCAN = 'file-scan';
export const QUEUE_FILE_SHARE_NOTIFY = 'file-share-notify';

export interface IngestJobData {
  schoolId: string;
  ownerId: string;
  bucket: string;
  storagePath: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** e.g. the report_book id this file was generated from. */
  sourceRef?: string;
}

/** Scan a manually-uploaded file, then mark it ready / infected / failed. */
export interface ScanJobData {
  fileId: string;
}

/** Notify the recipients of a newly created share. */
export interface ShareNotifyJobData {
  shareId: string;
}
