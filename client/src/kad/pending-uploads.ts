/**
 * client/src/kad/pending-uploads.ts — in-memory handoff for real `File`
 * objects between CongViecMoi.tsx's "Ngay" submit and TraoDoiCongViec.tsx's
 * fresh-task-create effect.
 *
 * Why this exists: for "Ngay", the task doesn't exist yet when the user
 * attaches files in the composer (upload needs a real task id first), and
 * `navigate(path, { state })` is not a safe way to carry `File` objects
 * across the route change (React Router's in-memory state is fine for plain
 * data, but relying on browsers' structured-clone support for `File` there
 * is fragile and undocumented behavior, not a contract to build on). A
 * module-level map keyed by the same client-generated id used in the URL
 * survives the client-side navigation (same JS runtime, no reload) and is
 * read exactly once.
 */
const pending = new Map<string, File[]>();

export function stashPendingFiles(clientId: string, files: File[]): void {
  if (files.length) pending.set(clientId, files);
}

/** Reads and clears — a stash is consumed exactly once. */
export function takePendingFiles(clientId: string): File[] {
  const files = pending.get(clientId) ?? [];
  pending.delete(clientId);
  return files;
}
