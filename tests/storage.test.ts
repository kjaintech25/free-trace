import "fake-indexeddb/auto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReferencePatch,
  StorageError,
  StorageResult,
} from "@/lib/storage";

// ---------------------------------------------------------------------------
// HARNESS NOTE — READ BEFORE ADDING A BLOB TEST ANYWHERE (T-04, T-05).
//
// fake-indexeddb v6 stores values with Node's native `structuredClone`. Node
// serialises ITS OWN Blob correctly, but jsdom's Blob is an ordinary class the
// serialiser does not recognise, so a jsdom Blob comes back as a bare object:
// no `type`, no `size`, no `arrayBuffer()`. NOTHING THROWS. A test that only
// checks the field is truthy passes while the image has been destroyed.
//
// So this file installs Node's Blob as the global for the whole file. Real
// Safari stores real Blobs natively — this affects the harness only, never
// lib/storage.ts, which merely stores whatever Blob it is handed.
// (Cast, not `any`: Node's Blob and the DOM Blob are structurally the same
// thing but are declared by two different lib files.)
// ---------------------------------------------------------------------------
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;

type StorageModule = typeof import("@/lib/storage");

let storage: StorageModule;

beforeEach(async () => {
  // A brand-new factory per test throws away every database and every open
  // connection from the previous test, with no deleteDatabase blocking.
  globalThis.indexedDB = new IDBFactory();
  // lib/storage.ts caches its connection in module scope, so the module has to
  // be re-instantiated alongside the factory or test 2 would reuse test 1's
  // handle onto a database that no longer exists.
  vi.resetModules();
  storage = await import("@/lib/storage");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ---------------------------------------------------------------

function unwrap<T>(result: StorageResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.error.kind}: ${result.error.message}`,
    );
  }
  return result.value;
}

function failure<T>(result: StorageResult<T>): StorageError {
  if (result.ok) throw new Error("expected a failure result, got ok");
  return result.error;
}

const SETTINGS = {
  edgeStrength: 55,
  threshold: 120,
  thickness: 2,
  inverted: false,
};

/** Distinct byte patterns per field so a mix-up cannot pass unnoticed. */
function makeInput(overrides: Partial<Parameters<StorageModule["saveReference"]>[0]> = {}) {
  return {
    originalImage: new Blob([new Uint8Array([10, 20, 30, 255])], {
      type: "image/jpeg",
    }),
    lineArtImage: new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7])], {
      type: "image/png",
    }),
    thumbnail: new Blob([new Uint8Array([9, 8])], { type: "image/jpeg" }),
    settings: { ...SETTINGS },
    ...overrides,
  };
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/** Opens the database directly (no idb) — harness setup only. */
async function openRawAtVersion(version: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.open("freetrace", version);
    request.onupgradeneeded = () => {
      /* no stores needed; we only want the version bumped */
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

// ===========================================================================
// saveReference
// ===========================================================================

describe("saveReference", () => {
  it("stores a record with a generated id and the SPEC §5 defaults", async () => {
    const record = unwrap(await storage.saveReference(makeInput()));

    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(record.name).toBe("Untitled");
    expect(record.lastOpacity).toBe(100);
    expect(typeof record.createdAt).toBe("number");
    expect(record.settings).toEqual(SETTINGS);
  });

  it("honours a supplied name and lastOpacity", async () => {
    const record = unwrap(
      await storage.saveReference(
        makeInput({ name: "Hand study", lastOpacity: 40 }),
      ),
    );
    expect(record.name).toBe("Hand study");
    expect(record.lastOpacity).toBe(40);
  });

  it("clamps lastOpacity into the 0–100 range SPEC §5 promises", async () => {
    const high = unwrap(await storage.saveReference(makeInput({ lastOpacity: 900 })));
    const low = unwrap(await storage.saveReference(makeInput({ lastOpacity: -5 })));
    expect(high.lastOpacity).toBe(100);
    expect(low.lastOpacity).toBe(0);
  });

  it("gives every reference a distinct id", async () => {
    const a = unwrap(await storage.saveReference(makeInput()));
    const b = unwrap(await storage.saveReference(makeInput()));
    expect(a.id).not.toBe(b.id);
  });
});

// ===========================================================================
// Blob round-trip — the criterion that images are never base64
// ===========================================================================

describe("blob round-trip", () => {
  it("returns all three images as Blobs with identical type, size and bytes", async () => {
    const input = makeInput();
    const saved = unwrap(await storage.saveReference(input));

    // Read back through a fresh get, so this asserts what IndexedDB actually
    // stored — not the in-memory object saveReference happened to return.
    const loaded = unwrap(await storage.getReference(saved.id));

    for (const field of ["originalImage", "lineArtImage", "thumbnail"] as const) {
      const before = input[field];
      const after = loaded[field];
      expect(after, `${field} is a Blob`).toBeInstanceOf(Blob);
      expect(after.type, `${field} type`).toBe(before.type);
      expect(after.size, `${field} size`).toBe(before.size);
      expect(await bytesOf(after), `${field} bytes`).toEqual(
        await bytesOf(before),
      );
    }

    expect(loaded.originalImage.type).toBe("image/jpeg");
    expect(loaded.lineArtImage.type).toBe("image/png");
  });

  it("survives an update that replaces the line art", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    const retuned = new Blob([new Uint8Array([42, 43, 44])], {
      type: "image/png",
    });

    unwrap(await storage.updateReference(saved.id, { lineArtImage: retuned }));
    const loaded = unwrap(await storage.getReference(saved.id));

    expect(loaded.lineArtImage).toBeInstanceOf(Blob);
    expect(loaded.lineArtImage.size).toBe(3);
    expect(await bytesOf(loaded.lineArtImage)).toEqual([42, 43, 44]);
    // The untouched image is still intact.
    expect(await bytesOf(loaded.originalImage)).toEqual([10, 20, 30, 255]);
  });
});

// ===========================================================================
// getReference
// ===========================================================================

describe("getReference", () => {
  it("reads back a saved reference", async () => {
    const saved = unwrap(await storage.saveReference(makeInput({ name: "Cat" })));
    const loaded = unwrap(await storage.getReference(saved.id));
    expect(loaded.id).toBe(saved.id);
    expect(loaded.name).toBe("Cat");
    expect(loaded.settings).toEqual(SETTINGS);
  });

  it("returns a typed not-found error for an unknown id", async () => {
    const error = failure(await storage.getReference("no-such-id"));
    expect(error.kind).toBe("not-found");
    expect(error.message.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// listReferences
// ===========================================================================

describe("listReferences", () => {
  it("returns an empty array when nothing is saved", async () => {
    expect(unwrap(await storage.listReferences())).toEqual([]);
  });

  it("orders three records newest first", async () => {
    // Drive createdAt through Date.now rather than a saveReference argument,
    // so this proves the real stamping path. Three saves in a tight loop would
    // otherwise share a millisecond and prove nothing about ordering.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);

    const oldest = unwrap(await storage.saveReference(makeInput({ name: "oldest" })));
    clock += 5_000;
    const middle = unwrap(await storage.saveReference(makeInput({ name: "middle" })));
    clock += 5_000;
    const newest = unwrap(await storage.saveReference(makeInput({ name: "newest" })));

    const list = unwrap(await storage.listReferences());

    expect(list.map((r) => r.name)).toEqual(["newest", "middle", "oldest"]);
    expect(list.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(list.map((r) => r.createdAt)).toEqual([
      1_700_000_010_000, 1_700_000_005_000, 1_700_000_000_000,
    ]);
  });

  it("keeps images intact for every listed record", async () => {
    await storage.saveReference(makeInput());
    const [only] = unwrap(await storage.listReferences());
    expect(only.thumbnail).toBeInstanceOf(Blob);
    expect(await bytesOf(only.thumbnail)).toEqual([9, 8]);
  });
});

// ===========================================================================
// updateReference
// ===========================================================================

describe("updateReference", () => {
  it("applies a partial patch and leaves everything else alone", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    const updated = unwrap(
      await storage.updateReference(saved.id, { name: "Renamed", lastOpacity: 35 }),
    );

    expect(updated.name).toBe("Renamed");
    expect(updated.lastOpacity).toBe(35);
    expect(updated.settings).toEqual(SETTINGS);
    expect(updated.createdAt).toBe(saved.createdAt);

    // Persisted, not just returned.
    const loaded = unwrap(await storage.getReference(saved.id));
    expect(loaded.name).toBe("Renamed");
    expect(loaded.lastOpacity).toBe(35);
  });

  it("merges settings field by field", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    const updated = unwrap(
      await storage.updateReference(saved.id, { settings: { threshold: 200 } }),
    );

    expect(updated.settings).toEqual({ ...SETTINGS, threshold: 200 });
  });

  it("clamps a patched lastOpacity", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    const updated = unwrap(
      await storage.updateReference(saved.id, { lastOpacity: 400 }),
    );
    expect(updated.lastOpacity).toBe(100);
  });

  it("refuses to move id or createdAt even if a caller passes them", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    // The patch type already forbids these; the cast reproduces what an
    // untyped caller (or a future refactor) could still hand us at runtime.
    const rogue = {
      name: "Renamed",
      id: "some-other-id",
      createdAt: 0,
    } as unknown as ReferencePatch;

    const updated = unwrap(await storage.updateReference(saved.id, rogue));

    expect(updated.id).toBe(saved.id);
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.name).toBe("Renamed");
    // And no second record was created under the rogue id.
    expect(unwrap(await storage.listReferences())).toHaveLength(1);
  });

  it("returns a typed not-found error for an unknown id", async () => {
    const error = failure(
      await storage.updateReference("no-such-id", { name: "x" }),
    );
    expect(error.kind).toBe("not-found");
  });
});

// ===========================================================================
// deleteReference
// ===========================================================================

describe("deleteReference", () => {
  it("removes the reference", async () => {
    const saved = unwrap(await storage.saveReference(makeInput()));
    unwrap(await storage.deleteReference(saved.id));

    expect(failure(await storage.getReference(saved.id)).kind).toBe("not-found");
    expect(unwrap(await storage.listReferences())).toEqual([]);
  });

  it("leaves the other references alone", async () => {
    const keep = unwrap(await storage.saveReference(makeInput({ name: "keep" })));
    const drop = unwrap(await storage.saveReference(makeInput({ name: "drop" })));

    unwrap(await storage.deleteReference(drop.id));

    const list = unwrap(await storage.listReferences());
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(keep.id);
  });

  it("is idempotent — deleting a missing id still succeeds", async () => {
    const result = await storage.deleteReference("never-existed");
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// clearAll
// ===========================================================================

describe("clearAll", () => {
  it("empties both stores", async () => {
    await storage.saveReference(makeInput());
    await storage.saveReference(makeInput());
    unwrap(await storage.setPreference("defaultOpacity", 60));

    unwrap(await storage.clearAll());

    expect(unwrap(await storage.listReferences())).toEqual([]);
    expect(unwrap(await storage.getPreference("defaultOpacity"))).toBeUndefined();
  });

  it("succeeds on an already-empty database", async () => {
    expect((await storage.clearAll()).ok).toBe(true);
  });
});

// ===========================================================================
// preferences
// ===========================================================================

describe("preferences", () => {
  it("returns undefined for a key that was never set", async () => {
    expect(unwrap(await storage.getPreference("keepAwake"))).toBeUndefined();
  });

  it("round-trips primitives and objects under the caller's type", async () => {
    unwrap(await storage.setPreference("defaultOpacity", 45));
    unwrap(await storage.setPreference("keepAwake", true));
    unwrap(await storage.setPreference("lastUsed", { id: "abc", at: 12 }));

    expect(unwrap(await storage.getPreference<number>("defaultOpacity"))).toBe(45);
    expect(unwrap(await storage.getPreference<boolean>("keepAwake"))).toBe(true);
    expect(
      unwrap(await storage.getPreference<{ id: string; at: number }>("lastUsed")),
    ).toEqual({ id: "abc", at: 12 });
  });

  it("replaces an existing value rather than appending", async () => {
    unwrap(await storage.setPreference("defaultOpacity", 45));
    unwrap(await storage.setPreference("defaultOpacity", 70));
    expect(unwrap(await storage.getPreference<number>("defaultOpacity"))).toBe(70);
  });
});

// ===========================================================================
// Failure mode 1 — quota exceeded
// ===========================================================================

describe("quota-exceeded failures", () => {
  function throwQuota(): never {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }

  it("surfaces a quota-exceeded error from saveReference instead of throwing", async () => {
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(throwQuota);

    const result = await storage.saveReference(makeInput());

    expect(result.ok).toBe(false);
    const error = failure(result);
    expect(error.kind).toBe("quota-exceeded");
    expect(error.message).toContain("space");
    expect(error.cause).toBeInstanceOf(DOMException);
  });

  it("surfaces a quota-exceeded error from a put", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(throwQuota);

    expect(failure(await storage.setPreference("defaultOpacity", 10)).kind).toBe(
      "quota-exceeded",
    );
  });

  it("recognises Firefox's legacy quota name", async () => {
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED");
    });

    expect(failure(await storage.saveReference(makeInput())).kind).toBe(
      "quota-exceeded",
    );
  });

  it("reports quota, not unavailable, when the open itself runs out of space", async () => {
    // Some browsers refuse to open the database at all once the origin is over
    // quota. The user can act on that, so it must not be flattened into the
    // generic "storage unreachable" message.
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(throwQuota);

    expect(failure(await storage.listReferences()).kind).toBe("quota-exceeded");
  });

  it("does not mislabel an unrelated failure as a quota problem", async () => {
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
      throw new DOMException("boom", "DataError");
    });

    expect(failure(await storage.saveReference(makeInput())).kind).toBe("unknown");
  });
});

// ===========================================================================
// Failure mode 2 — storage unavailable (Private Browsing / open fails)
// ===========================================================================

describe("unavailable failures", () => {
  it("every method returns unavailable when indexedDB is missing", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");

    const results: Array<[string, StorageResult<unknown>]> = [
      ["saveReference", await storage.saveReference(makeInput())],
      ["getReference", await storage.getReference("id")],
      ["listReferences", await storage.listReferences()],
      ["updateReference", await storage.updateReference("id", { name: "x" })],
      ["deleteReference", await storage.deleteReference("id")],
      ["clearAll", await storage.clearAll()],
      ["getPreference", await storage.getPreference("k")],
      ["setPreference", await storage.setPreference("k", 1)],
    ];

    for (const [name, result] of results) {
      expect(result.ok, `${name} should fail`).toBe(false);
      expect(failure(result).kind, `${name} kind`).toBe("unavailable");
      expect(failure(result).message, `${name} message`).toContain(
        "Private Browsing",
      );
    }
  });

  it("returns unavailable when opening the database throws synchronously", async () => {
    // Private Browsing in older Safari refused the open outright.
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(failure(await storage.listReferences()).kind).toBe("unavailable");
  });

  it("returns unavailable when the open request fails asynchronously", async () => {
    // The on-device database is at v2 while this build asks for v1 — what a
    // downgraded app sees. IndexedDB fails this open on the request, not
    // synchronously, which is the other half of the open-failure surface.
    await openRawAtVersion(2);

    expect(failure(await storage.listReferences()).kind).toBe("unavailable");
  });

  it("does not leave an unhandled rejection when the open fails", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);

    try {
      await openRawAtVersion(2);
      expect((await storage.listReferences()).ok).toBe(false);
      expect((await storage.getPreference("k")).ok).toBe(false);
      // Let the microtask queue drain and a macrotask elapse — Node reports an
      // unhandled rejection only after that.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", listener);
    }

    expect(unhandled).toEqual([]);
  });

  it("recovers once storage becomes reachable again", async () => {
    // A failed open must not be cached, or one Private Browsing miss would
    // poison the whole session.
    const spy = vi
      .spyOn(IDBFactory.prototype, "open")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    expect(failure(await storage.listReferences()).kind).toBe("unavailable");

    spy.mockRestore();
    expect(unwrap(await storage.listReferences())).toEqual([]);
  });
});

// ===========================================================================
// Schema
// ===========================================================================

describe("schema", () => {
  it("creates freetrace v1 with both stores and the createdAt index", async () => {
    // Touch the module so it opens the database.
    await storage.listReferences();

    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.open("freetrace");
      request.onsuccess = () => {
        const db = request.result;
        try {
          expect(db.name).toBe("freetrace");
          expect(db.version).toBe(1);
          expect([...db.objectStoreNames].sort()).toEqual([
            "preferences",
            "references",
          ]);
          const tx = db.transaction("references", "readonly");
          expect([...tx.objectStore("references").indexNames]).toEqual([
            "createdAt",
          ]);
          expect(tx.objectStore("references").keyPath).toBe("id");
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          db.close();
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
});
