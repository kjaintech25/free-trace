/**
 * lib/storage.ts — the single IndexedDB access point for Free Trace (SPEC §5).
 *
 * Rules this module exists to enforce:
 *  - No other module, and specifically no React component, imports `idb` or
 *    touches `indexedDB`. Everything goes through the typed API below.
 *  - Images are stored as Blobs, natively. Never encoded into a string,
 *    a data: URL, or any other text form.
 *  - Nothing here throws out of the public API and nothing leaves a rejected
 *    promise unhandled. Every exported function resolves to a `StorageResult`
 *    discriminated union, so a caller cannot forget the failure path
 *    (SPEC §5, §9).
 *
 * Deliberately no `console.error` in this file: the failure is returned to the
 * caller with its underlying `cause` attached, and the UI layer decides what to
 * log and what to show. A library that logs on the caller's behalf produces
 * noise the caller cannot switch off.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** SPEC §5 / DECISIONS #1 — the database is `freetrace`, not `tracepaper`. */
export const DB_NAME = "freetrace";
export const DB_VERSION = 1;

/** Opacity a reference starts at when the caller does not supply one (0–100). */
const DEFAULT_OPACITY = 100;

// ---------------------------------------------------------------------------
// Record types (SPEC §5)
// ---------------------------------------------------------------------------

/** The four line-art controls, stored so a reference can be re-tuned later. */
export interface ReferenceSettings {
  edgeStrength: number;
  threshold: number;
  thickness: number;
  inverted: boolean;
}

export interface Reference {
  /** crypto.randomUUID() */
  id: string;
  /** User-editable label; defaults to "Untitled". */
  name: string;
  /** The imported photo, as imported. */
  originalImage: Blob;
  /** PNG of the converted line art — this is what gets traced. */
  lineArtImage: Blob;
  /** Small JPEG for the library grid (max 400px long edge). */
  thumbnail: Blob;
  settings: ReferenceSettings;
  /** 0–100. Remembers the trace-screen slider position. */
  lastOpacity: number;
  /** Date.now() at save time. Identity, never patchable. */
  createdAt: number;
}

/** A `preferences` row. Values are opaque here; the caller names their shape. */
export interface PreferenceRecord {
  key: string;
  value: unknown;
}

/**
 * What a caller supplies to create a reference. `id` and `createdAt` are
 * generated here on purpose — a caller must not be able to overwrite an
 * existing reference by reusing an id, or fake its position in the library.
 */
export interface NewReference {
  originalImage: Blob;
  lineArtImage: Blob;
  thumbnail: Blob;
  settings: ReferenceSettings;
  /** Defaults to "Untitled". */
  name?: string;
  /** 0–100. Defaults to 100; pass the user's default-opacity preference. */
  lastOpacity?: number;
}

/**
 * A partial update. `id` and `createdAt` are identity and cannot be patched;
 * `settings` merges field-by-field so a single slider can be updated alone.
 */
export type ReferencePatch = Partial<
  Omit<Reference, "id" | "createdAt" | "settings">
> & {
  settings?: Partial<ReferenceSettings>;
};

// ---------------------------------------------------------------------------
// Result and error types
// ---------------------------------------------------------------------------

export type StorageErrorKind =
  | "quota-exceeded"
  | "unavailable"
  | "not-found"
  | "unknown";

export interface StorageError {
  kind: StorageErrorKind;
  /** Plain English, safe to render to the user exactly as-is. */
  message: string;
  /** The underlying failure, for logging. Never render this. */
  cause?: unknown;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageError };

const MESSAGES: Record<StorageErrorKind, string> = {
  "quota-exceeded":
    "There isn't enough space left on this device to save that. Delete a reference you've finished with and try again.",
  unavailable:
    "Free Trace can't reach this device's storage. Private Browsing blocks it — open the app in a normal Safari tab.",
  "not-found": "That reference isn't in your library any more.",
  unknown: "Something went wrong reading your library. Please try again.",
};

function ok<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

function fail<T>(kind: StorageErrorKind, cause?: unknown): StorageResult<T> {
  return { ok: false, error: { kind, message: MESSAGES[kind], cause } };
}

/** Internal marker for "the database could not be opened at all". */
class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("IndexedDB is unavailable");
    this.name = "StorageUnavailableError";
    this.cause = cause;
  }
}

/**
 * Quota failures arrive as a DOMException. Duck-type rather than
 * `instanceof DOMException`: the exception can cross a realm boundary (worker,
 * test harness) where the constructor identity no longer matches.
 */
function isQuotaError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, code } = err as { name?: unknown; code?: unknown };
  if (
    name === "QuotaExceededError" ||
    // Firefox's legacy name for the same condition.
    name === "NS_ERROR_DOM_QUOTA_REACHED"
  ) {
    return true;
  }
  // Legacy numeric DOMException code QUOTA_EXCEEDED_ERR.
  return code === 22;
}

function classify<T>(err: unknown): StorageResult<T> {
  if (err instanceof StorageUnavailableError) {
    // Running out of space while opening is still a quota problem, and the
    // user can act on it — don't flatten it into "storage unreachable".
    if (isQuotaError(err.cause)) return fail("quota-exceeded", err.cause);
    return fail("unavailable", err.cause ?? err);
  }
  if (isQuotaError(err)) return fail("quota-exceeded", err);
  return fail("unknown", err);
}

// ---------------------------------------------------------------------------
// Schema and connection
// ---------------------------------------------------------------------------

interface FreeTraceDB extends DBSchema {
  references: {
    key: string;
    value: Reference;
    indexes: { createdAt: number };
  };
  preferences: {
    key: string;
    value: PreferenceRecord;
  };
}

/**
 * Migrations are cumulative: a database at any older version falls through
 * every block below whose version it has not reached, in order. Never edit a
 * block that has shipped — add a new one.
 */
function upgrade(db: IDBPDatabase<FreeTraceDB>, oldVersion: number): void {
  if (oldVersion < 1) {
    const references = db.createObjectStore("references", { keyPath: "id" });
    // The library is always newest-first (SPEC §6.1). This index lets
    // IndexedDB walk the records in that order itself, so listing never has
    // to load every record and sort it in memory.
    references.createIndex("createdAt", "createdAt");

    db.createObjectStore("preferences", { keyPath: "key" });
  }

  // --- v2 migration slots in here ------------------------------------------
  // if (oldVersion < 2) {
  //   // New stores and indexes go here, then bump DB_VERSION to 2.
  // }
  //
  // To rewrite EXISTING rows (backfill a new field, reshape `settings`), widen
  // this signature — idb calls it as
  //   upgrade(db, oldVersion, newVersion, transaction, event)
  // and that 4th argument is the live versionchange transaction, the only
  // place existing records can be read and written during an upgrade. It is
  // left off here because v1 creates empty stores and has nothing to migrate.
}

let dbPromise: Promise<IDBPDatabase<FreeTraceDB>> | null = null;

function indexedDBAvailable(): boolean {
  try {
    return typeof globalThis.indexedDB !== "undefined" && globalThis.indexedDB !== null;
  } catch {
    // Reading the property itself can throw in some locked-down privacy modes.
    return false;
  }
}

/** Drop the cached connection so the next call opens a fresh one. */
function resetConnection(close: boolean): void {
  const pending = dbPromise;
  dbPromise = null;
  if (close && pending) {
    void pending.then((db) => db.close()).catch(() => {});
  }
}

async function getDB(): Promise<IDBPDatabase<FreeTraceDB>> {
  if (!indexedDBAvailable()) {
    throw new StorageUnavailableError("indexedDB is not present on this device");
  }

  if (dbPromise === null) {
    try {
      // `openDB` can refuse synchronously (Private Browsing in older Safari
      // threw straight out of `indexedDB.open`) as well as reject later. Both
      // are the same failure and both must be wrapped, or the synchronous one
      // reaches `classify` as a bare DOMException and is reported as
      // "unknown" instead of "unavailable".
      const pending = openDB<FreeTraceDB>(DB_NAME, DB_VERSION, {
        upgrade,
        blocking() {
          // A newer version wants to upgrade in another tab. Close this
          // connection so it can proceed; the next call reopens at the new
          // version.
          resetConnection(true);
        },
        terminated() {
          // The browser killed the connection (backgrounded tab, storage
          // pressure). Never hand out the dead handle again.
          resetConnection(false);
        },
      });
      // Attach a handler the moment the promise exists, so a failed open can
      // never surface as an unhandled rejection even if no caller is awaiting.
      void pending.catch(() => {});
      dbPromise = pending;
    } catch (err) {
      // Nothing was cached, so the next call retries from scratch.
      throw new StorageUnavailableError(err);
    }
  }

  try {
    return await dbPromise;
  } catch (err) {
    // A failed open must not be cached, or one Private Browsing miss would
    // poison every later call in the session.
    dbPromise = null;
    throw new StorageUnavailableError(err);
  }
}

/**
 * Runs one storage operation with the whole failure surface handled: opening
 * the database, and the operation itself. This is the only place the public
 * API is allowed to catch, which is what keeps every export throw-free.
 */
async function attempt<T>(
  op: (db: IDBPDatabase<FreeTraceDB>) => Promise<StorageResult<T>>,
): Promise<StorageResult<T>> {
  let db: IDBPDatabase<FreeTraceDB>;
  try {
    db = await getDB();
  } catch (err) {
    // Anything that stops the database opening at all — Private Browsing, a
    // missing indexedDB, a database newer than this build — is `unavailable`.
    // `getDB` only ever throws StorageUnavailableError, so `classify` also
    // recovers a quota failure that happened during the open.
    return classify(err);
  }

  try {
    return await op(db);
  } catch (err) {
    return classify(err);
  }
}

/** SPEC §5 types `lastOpacity` as 0–100; keep that true in the store. */
function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_OPACITY;
  return Math.min(100, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Writes a new reference and returns the stored record, including the id the
 * caller needs to navigate to `/trace/[id]`.
 */
export async function saveReference(
  input: NewReference,
): Promise<StorageResult<Reference>> {
  return attempt(async (db) => {
    const record: Reference = {
      id: crypto.randomUUID(),
      name: input.name ?? "Untitled",
      originalImage: input.originalImage,
      lineArtImage: input.lineArtImage,
      thumbnail: input.thumbnail,
      settings: { ...input.settings },
      lastOpacity: clampOpacity(input.lastOpacity ?? DEFAULT_OPACITY),
      createdAt: Date.now(),
    };
    // `add`, not `put`: if a generated id ever collided, failing loudly is far
    // better than silently overwriting somebody's reference.
    await db.add("references", record);
    return ok(record);
  });
}

/** Reads one reference. A missing id is a `not-found` error, not `undefined`. */
export async function getReference(
  id: string,
): Promise<StorageResult<Reference>> {
  return attempt(async (db) => {
    const record = await db.get("references", id);
    if (record === undefined) return fail("not-found", id);
    return ok(record);
  });
}

/** Every reference, newest first (SPEC §6.1). */
export async function listReferences(): Promise<StorageResult<Reference[]>> {
  return attempt(async (db) => {
    const tx = db.transaction("references", "readonly");
    const byCreatedAt = tx.store.index("createdAt");
    const records: Reference[] = [];
    // "prev" walks the index from the highest createdAt down, so IndexedDB
    // does the ordering — we never load-then-sort.
    let cursor = await byCreatedAt.openCursor(null, "prev");
    while (cursor) {
      records.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return ok(records);
  });
}

/**
 * Applies a partial patch and returns the updated record. Read and write share
 * one transaction, so a concurrent write cannot land between them.
 */
export async function updateReference(
  id: string,
  patch: ReferencePatch,
): Promise<StorageResult<Reference>> {
  return attempt(async (db) => {
    const tx = db.transaction("references", "readwrite");
    const existing = await tx.store.get(id);

    if (existing === undefined) {
      // Let the transaction close cleanly rather than aborting it, so nothing
      // escapes from `tx.done` after we have already returned.
      await tx.done;
      return fail("not-found", id);
    }

    const updated: Reference = {
      ...existing,
      ...patch,
      // Identity fields survive any patch, whatever the caller passed.
      id: existing.id,
      createdAt: existing.createdAt,
      settings: patch.settings
        ? { ...existing.settings, ...patch.settings }
        : existing.settings,
      lastOpacity:
        patch.lastOpacity === undefined
          ? existing.lastOpacity
          : clampOpacity(patch.lastOpacity),
    };

    await tx.store.put(updated);
    await tx.done;
    return ok(updated);
  });
}

/**
 * Removes a reference. Deleting an id that is already gone succeeds — delete
 * is idempotent, and a second tap on a delete button is not an error.
 */
export async function deleteReference(
  id: string,
): Promise<StorageResult<void>> {
  return attempt(async (db) => {
    await db.delete("references", id);
    return ok(undefined);
  });
}

/** Wipes both stores — the "clear all data" action in Settings (SPEC §6.4). */
export async function clearAll(): Promise<StorageResult<void>> {
  return attempt(async (db) => {
    // One transaction across both stores: either everything clears or nothing
    // does, so "clear all data" can never half-succeed.
    const tx = db.transaction(["references", "preferences"], "readwrite");
    await Promise.all([
      tx.objectStore("references").clear(),
      tx.objectStore("preferences").clear(),
      tx.done,
    ]);
    return ok(undefined);
  });
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Reads a preference. A missing key resolves to `ok(undefined)` rather than a
 * `not-found` error: an unset preference is the normal case and the caller
 * simply uses its default. (`getReference` differs on purpose — there, a
 * missing id means a broken link and the user should be told.)
 *
 * `T` is the caller's assertion about what it stored; values come back as the
 * `unknown` they went in as.
 */
export async function getPreference<T>(
  key: string,
): Promise<StorageResult<T | undefined>> {
  return attempt(async (db) => {
    const record = await db.get("preferences", key);
    return ok(record === undefined ? undefined : (record.value as T));
  });
}

/** Writes a preference, replacing any existing value for that key. */
export async function setPreference<T>(
  key: string,
  value: T,
): Promise<StorageResult<void>> {
  return attempt(async (db) => {
    await db.put("preferences", { key, value });
    return ok(undefined);
  });
}
