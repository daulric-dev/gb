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
  /** The owner's folder placement; null at the root of My files. */
  folderId: string | null;
  /** Whether the current viewer may download (owner, or a downloadable share). */
  canDownload: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response of GET /files/folders/contents. */
export interface FolderContents {
  folder: { id: string; name: string; parentId: string | null } | null;
  breadcrumb: FolderItem[];
  folders: FolderItem[];
  files: FileItem[];
}

export type SharePrincipalType = "user" | "role" | "group";

export interface FileShare {
  id: string;
  principal_type: SharePrincipalType;
  principal_id: string;
  can_download: boolean;
  created_at: string;
}
