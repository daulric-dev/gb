/** A generated file ready to be streamed to the client. */
export interface GeneratedFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export const CONTENT_TYPES = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
} as const;

export type FileFormat = keyof typeof CONTENT_TYPES;
