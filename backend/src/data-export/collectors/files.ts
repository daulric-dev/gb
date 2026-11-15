import { objectKey } from '@/storage/keys';
import type { Collector, ExportObject } from '../data-export.types';
import { inSchool, safeName, schoolNames } from './helpers';

/** The ZIP path of a file-manager file. */
export const filePath = (folder: string, f: { id: string; name: string }) =>
  `files/${folder}/${f.id.slice(0, 8)}-${safeName(f.name)}`;

/**
 * A file-manager file as an object to copy, when it is safe to: files still
 * scanning, failed or flagged as infected are listed but not copied.
 */
export function fileObject(
  folder: string,
  f: { id: string; name: string; bucket: string; storage_path: string; status: string; size_bytes: bigint | number },
): ExportObject | null {
  if (f.status !== 'ready') return null;
  return { path: filePath(folder, f), key: objectKey(f.bucket, f.storage_path), size: Number(f.size_bytes) };
}

export const filesCollector: Collector = {
  id: 'files',
  title: 'Files',
  description:
    'Files in the account\'s file manager (including ones in the bin), its folders, the shares it made, and the files other people shared with it (names only; their content belongs to whoever shared them). Uploaded files are copied into files/my-files/.',
  covers: [
    'file_manager.file.owner_id',
    'file_manager.folder.owner_id',
    'file_manager.file_share.created_by',
    'file_manager.file_share.principal_id',
  ],
  scopes: ['self', 'staff'],
  async collect(ctx) {
    const userId = ctx.subject.userId;
    if (!userId) return { data: { files: [], folders: [], sharesMade: [], sharedWithYou: [] }, count: 0 };
    const school = inSchool(ctx);
    const [files, folders, sharesMade, sharedWithYou] = await Promise.all([
      ctx.prisma.file.findMany({
        where: { owner_id: userId, ...school },
        select: {
          id: true,
          school_id: true,
          folder_id: true,
          name: true,
          bucket: true,
          storage_path: true,
          content_type: true,
          size_bytes: true,
          source: true,
          status: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
      ctx.prisma.folder.findMany({
        where: { owner_id: userId, ...school },
        select: { id: true, parent_id: true, name: true, is_system: true, created_at: true, deleted_at: true },
      }),
      ctx.prisma.file_share.findMany({
        where: { created_by: userId, ...school },
        select: { file_id: true, principal_type: true, can_download: true, created_at: true },
      }),
      ctx.prisma.file_share.findMany({
        where: { principal_type: 'user', principal_id: userId, ...school },
        select: { can_download: true, created_at: true, file: { select: { name: true, content_type: true } } },
      }),
    ]);
    const schools = await schoolNames(ctx, files.map((f) => f.school_id));
    const objects: ExportObject[] = [];
    const data = {
      files: files.map((f) => {
        const obj = fileObject('my-files', f);
        if (obj) objects.push(obj);
        return {
          id: f.id,
          name: f.name,
          school: schools.get(f.school_id) ?? null,
          folderId: f.folder_id,
          contentType: f.content_type,
          sizeBytes: Number(f.size_bytes),
          source: f.source,
          scanStatus: f.status,
          createdAt: f.created_at,
          updatedAt: f.updated_at,
          inBinSince: f.deleted_at,
          copiedTo: obj?.path ?? null,
        };
      }),
      folders: folders.map((f) => ({
        id: f.id,
        parentId: f.parent_id,
        name: f.name,
        system: f.is_system,
        createdAt: f.created_at,
        inBinSince: f.deleted_at,
      })),
      sharesMade: sharesMade.map((s) => ({
        fileId: s.file_id,
        sharedWith: s.principal_type,
        canDownload: s.can_download,
        sharedAt: s.created_at,
      })),
      sharedWithYou: sharedWithYou.map((s) => ({
        name: s.file.name,
        contentType: s.file.content_type,
        canDownload: s.can_download,
        sharedAt: s.created_at,
      })),
    };
    const count = data.files.length + data.folders.length + data.sharesMade.length + data.sharedWithYou.length;
    return { data, count, objects };
  },
};
