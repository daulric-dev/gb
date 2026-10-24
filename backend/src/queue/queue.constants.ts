export const QUEUE_FILE_SHARE_NOTIFY = 'file-share-notify';

/** Notify the recipients of a newly created share. */
export interface ShareNotifyJobData {
  shareId: string;
}
