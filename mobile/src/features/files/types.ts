/**
 * Section-local types for the Files feature. Mirrors the web frontend's
 * `app/dashboard/files/_components/types.ts`. Kept local per convention —
 * do not add these to `@/lib/types`.
 */

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

/** Candidate principals for the share picker. */
export interface ShareMember {
  id: string;
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

export interface ShareRole {
  id: string;
  name: string;
}

export interface ShareClass {
  id: string;
  name: string | null;
}

export type Filter = "all" | "own" | "shared";

/** Human-readable file size, mirroring the web FilesTable. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
