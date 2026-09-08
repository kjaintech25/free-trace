/**
 * lib/pendingImport.ts — in-memory hand-off between the import flow and the
 * convert screen (SPEC §6.1 -> §6.2; T-04 -> T-07).
 *
 * `AddPhotoButton` decodes a photo, stashes the result here, then navigates
 * to `/convert`. `/convert` (built in T-07, a different ticket/lane) reads it
 * back with `takePendingImport`. This is deliberately module-scoped memory,
 * not IndexedDB: the decoded image hasn't been saved as a reference yet —
 * that only happens when the user hits "Save to library" on /convert — so it
 * has no business in persistent storage, and a plain module variable is all
 * a same-tab client-side navigation needs.
 *
 * A hard reload or a direct link to /convert loses this value on purpose;
 * /convert is responsible for handling that empty case (e.g. by bouncing
 * back to the library), not this module.
 */

import type { ImportedImage } from "./import";

let pending: ImportedImage | null = null;

/** Stores the most recently decoded photo, replacing any previous one. */
export function setPendingImport(value: ImportedImage): void {
  pending = value;
}

/** Returns the stored photo and clears it — a one-time hand-off. */
export function takePendingImport(): ImportedImage | null {
  const value = pending;
  pending = null;
  return value;
}

/** Reads the stored photo without clearing it. */
export function peekPendingImport(): ImportedImage | null {
  return pending;
}
