export type FileStatus =
  | "pending"
  | "scanning"
  | "ready"
  | "failed"
  | "infected";

export interface FileItem {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  source: "report" | "upload";
  sourceRef: string | null;
  status: FileStatus;
  ownerId: string;
  /** Whether the current viewer may download (owner, or a downloadable share). */
  canDownload: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SharePrincipalType = "user" | "role" | "group";

export interface FileShare {
  id: string;
  principal_type: SharePrincipalType;
  principal_id: string;
  can_download: boolean;
  created_at: string;
}
