export const QUEUE_FILE_INGEST = 'file-ingest';
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
  /**
   * Optional system-folder path the ingested file should be filed under in the
   * owner's tree, e.g. ['Reports', '2026-07-12']. Folders are created on demand.
   */
  folderPath?: string[];
}

/** Notify the recipients of a newly created share. */
export interface ShareNotifyJobData {
  shareId: string;
}
