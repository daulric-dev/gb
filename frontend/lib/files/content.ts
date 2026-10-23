import { buildUrl } from "@/lib/api";

/**
 * Fetch a file's bytes from the backend. `content` is the view-only inline
 * stream (no signed URL is exposed); `download` is gated to owners and
 * recipients with download rights. Auth rides on the session cookie.
 */
export async function fetchFileBlob(
  fileId: string,
  mode: "content" | "download",
): Promise<Blob> {
  const res = await fetch(buildUrl(`/files/${fileId}/${mode}`), {
    headers: { "X-API-Version": "1" },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to load file (${res.status})`);
  }
  return res.blob();
}

/**
 * A file the course offers (module link or course share, even a colleague's),
 * opened by course staff. The file manager would refuse another teacher's
 * file, so this goes through the course, which checks it offers the file.
 */
export async function fetchStaffCourseFileBlob(
  courseId: string,
  fileId: string,
): Promise<Blob> {
  const res = await fetch(buildUrl(`/courses/${courseId}/files/${fileId}`), {
    headers: { "X-API-Version": "1" },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to load file (${res.status})`);
  }
  return res.blob();
}

/**
 * A file a student reaches through their course (a module link or a course
 * share). Students hold no file-manager permission, so this goes through the
 * portal, which checks the course offers the file.
 */
export async function fetchCourseFileBlob(
  courseId: string,
  fileId: string,
): Promise<Blob> {
  const res = await fetch(
    buildUrl(`/portal/me/courses/${courseId}/files/${fileId}`),
    { headers: { "X-API-Version": "1" }, credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(`Failed to load file (${res.status})`);
  }
  return res.blob();
}
